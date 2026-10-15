import { createHash, X509Certificate } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type PeerCertificate } from 'node:tls';
import { isIP } from 'node:net';

/** Why a site could not be reached (ADR 0077); the console explains each. */
export type FleetFailureCode = 'unreachable' | 'certificate' | 'revoked' | 'invalid' | 'refused';
export class FleetFailure extends Error {
  constructor(
    readonly code: FleetFailureCode,
    readonly status?: number,
  ) {
    super(`Site request failed: ${code}`);
    this.name = 'FleetFailure';
  }
}

/** Where a site answers and the certificate pinned for it; plain HTTP only on loopback. */
export interface FleetEndpoint {
  readonly url: string;
  /** SHA-256 of the certificate, hexadecimal; null for loopback HTTP. */
  readonly pin: string | null;
  /** The pinned certificate, PEM: the one trust anchor of requests to the site. */
  readonly certificate: string | null;
}
export interface FleetCertificate {
  readonly pin: string;
  readonly certificate: string;
  readonly subject: string;
  readonly issuer: string;
  readonly validTo: string;
}

const LIMIT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** The whole exchange, not only a quiet socket: a site dripping bytes cannot hold a round. */
const DEADLINE_MS = 15_000;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** `https://host[:port]` without path, query or credentials; HTTP only for loopback. */
export function siteOrigin(value: unknown): string {
  let url: URL;
  try {
    url = new URL(typeof value === 'string' ? value.trim() : '');
  } catch {
    throw new FleetFailure('invalid');
  }
  const plain = url.protocol === 'http:' && loopback.has(url.hostname);
  if (
    (url.protocol !== 'https:' && !plain) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new FleetFailure('invalid');
  return url.origin;
}

/** Printable ASCII up to 160 characters: a header value that cannot inject another header. */
const actorHeader = (actor: string) =>
  Array.from(actor)
    .map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '?'))
    .join('')
    .slice(0, 160);

/**
 * SHA-256 of the whole certificate, as browsers and `openssl x509 -fingerprint -sha256` show it:
 * the administrator can compare it anywhere. Empty without a certificate: never a pin.
 */
const pinOf = (certificate: PeerCertificate) =>
  Object.keys(certificate).length === 0
    ? ''
    : createHash('sha256').update(certificate.raw).digest('hex');

/** The fingerprint of a PEM certificate in the same form, for a site to show its own. */
export function certificateFingerprint(pemText: string): string {
  return new X509Certificate(pemText).fingerprint256.replaceAll(':', '').toLowerCase();
}
const pem = (raw: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${raw
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd()}\n-----END CERTIFICATE-----\n`;

/**
 * Reads the certificate a site presents, to show its fingerprint to the administrator before
 * anything is trusted. Nothing is sent over this connection: it is closed after the handshake.
 */
export function readSiteCertificate(origin: string): Promise<FleetCertificate> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || 443),
      ...(isIP(url.hostname.replace(/^\[|\]$/g, '')) ? {} : { servername: url.hostname }),
      // Only to read the certificate for the administrator's confirmation; no data follows.
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS,
    });
    const deadline = setTimeout(() => {
      socket.destroy();
      reject(new FleetFailure('unreachable'));
    }, DEADLINE_MS);
    deadline.unref();
    socket.once('close', () => {
      clearTimeout(deadline);
    });
    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate(false);
      socket.destroy();
      // Node returns an empty object when the peer sent no certificate: no site to trust.
      if (Object.keys(peer).length === 0) {
        reject(new FleetFailure('certificate'));
        return;
      }
      // A listener runs outside the promise: a certificate Node cannot read must reject here,
      // not throw out of the event loop.
      try {
        const raw = peer.raw;
        const parsed = new X509Certificate(raw);
        const validTo = new Date(parsed.validTo);
        if (!Number.isFinite(validTo.getTime())) throw new Error('Unreadable validity');
        resolve({
          pin: pinOf(peer),
          certificate: pem(raw),
          subject: parsed.subject.slice(0, 1024),
          issuer: parsed.issuer.slice(0, 1024),
          validTo: validTo.toISOString(),
        });
      } catch {
        reject(new FleetFailure('certificate'));
      }
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new FleetFailure('unreachable'));
    });
    socket.on('error', () => {
      reject(new FleetFailure('unreachable'));
    });
  });
}

/** The answer of a site: bounded, a refusal by its status whatever its body, else JSON. */
function readAnswer(
  response: IncomingMessage,
  maxBytes: number,
  resolve: (answer: { readonly status: number; readonly body: unknown }) => void,
  settle: (failure: FleetFailure) => void,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxBytes) {
      response.destroy();
      settle(new FleetFailure('invalid'));
    } else chunks.push(chunk);
  });
  response.once('end', () => {
    const status = response.statusCode ?? 0;
    if (status === 401) {
      settle(new FleetFailure('revoked', status));
      return;
    }
    if (status === 403) {
      settle(new FleetFailure('refused', status));
      return;
    }
    let body: unknown;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    } catch {
      settle(new FleetFailure('invalid', status));
      return;
    }
    resolve({ status, body });
  });
  response.on('error', () => {
    settle(new FleetFailure('unreachable'));
  });
}

/**
 * One JSON request to a site. Over HTTPS the pinned certificate is the only trust anchor and its
 * SHA-256 must match the pin: the chain is still verified, against that anchor only. Bodies
 * are bounded; redirects are not followed.
 */
export function siteRequest(
  endpoint: FleetEndpoint,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: {
    readonly key?: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
    /** The controller's administrator acting, for the site's audit; not a credential. */
    readonly actor?: string;
    /** Largest answer read; catalog pages are larger than state. */
    readonly maxBytes?: number;
    /** The longest the whole exchange may take; larger answers get longer. */
    readonly deadlineMs?: number;
  } = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const url = new URL(path, endpoint.url);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(payload === undefined
      ? {}
      : {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        }),
    ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
    ...(options.actor ? { 'arkvory-fleet-actor': actorHeader(options.actor) } : {}),
  };
  const secure = url.protocol === 'https:';
  if (secure && (!endpoint.pin || !endpoint.certificate))
    return Promise.reject(new FleetFailure('certificate'));
  return new Promise((resolve, reject) => {
    const settle = (failure: FleetFailure) => {
      reject(failure);
    };
    const request = (secure ? httpsRequest : httpRequest)(
      url,
      {
        method,
        headers,
        timeout: TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(secure
          ? {
              ca: [endpoint.certificate ?? ''],
              allowPartialTrustChain: true,
              checkServerIdentity: (_host: string, peer: PeerCertificate) =>
                pinOf(peer) === endpoint.pin ? undefined : new Error('Certificate pin mismatch'),
            }
          : {}),
      },
      (response) => {
        readAnswer(response, options.maxBytes ?? LIMIT_BYTES, resolve, settle);
      },
    );
    request.once('timeout', () => {
      request.destroy();
      settle(new FleetFailure('unreachable'));
    });
    const deadline = setTimeout(() => {
      request.destroy();
      settle(new FleetFailure('unreachable'));
    }, options.deadlineMs ?? DEADLINE_MS);
    deadline.unref();
    request.once('close', () => {
      clearTimeout(deadline);
    });
    request.on('error', (error: Error & { code?: string }) => {
      const tls =
        /CERT|SSL|TLS|pin mismatch|self.signed|UNABLE_TO/i.test(error.code ?? '') ||
        /pin mismatch|certificate/i.test(error.message);
      settle(new FleetFailure(tls ? 'certificate' : 'unreachable'));
    });
    request.end(payload);
  });
}

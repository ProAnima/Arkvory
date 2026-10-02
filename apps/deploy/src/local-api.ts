import { X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { request as plainRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { request as tlsRequest } from 'node:https';

export interface LocalTarget {
  readonly host: string;
  readonly port: string;
  /** Built-in HTTPS: the API must present exactly this configured certificate. */
  readonly certificateFile?: string;
}
export interface LocalResponse {
  readonly status: number;
  readonly body: string;
}
interface LocalRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

const maxBody = 1024 * 1024;

/**
 * Address local tooling uses to reach the API: loopback for wildcard binds, otherwise the
 * configured interface, because a server bound to one LAN address does not answer on loopback.
 */
export function localApiHost(bindHost: string | undefined): string {
  const host = bindHost ?? '';
  if (host === '' || host === '0.0.0.0') return '127.0.0.1';
  if (host === '::' || host === '[::]') return '[::1]';
  if (!/^(?:[A-Za-z0-9.-]{1,253}|\[?[0-9A-Fa-f:.]{2,45}\]?)$/.test(host))
    throw new Error('Invalid ARKVORY_HOST');
  if (host.includes(':')) return host.startsWith('[') ? host : `[${host}]`;
  return host;
}

/** Where installer tooling reaches its own API; Compose publishes 8080 on host loopback. */
export function localTarget(
  runtime: Readonly<Record<string, string | undefined>>,
  compose = false,
): LocalTarget {
  const port = compose ? '8080' : (runtime['ARKVORY_PORT'] ?? '8080');
  if (!/^[0-9]{1,5}$/.test(port)) throw new Error('Invalid API port');
  const certificateFile = runtime['ARKVORY_TLS_CERT_FILE']?.trim();
  if (compose && certificateFile)
    throw new Error('Built-in TLS is for native installations; use a reverse proxy with Compose');
  return {
    host: compose ? '127.0.0.1' : localApiHost(runtime['ARKVORY_HOST']),
    port,
    ...(certificateFile ? { certificateFile } : {}),
  };
}

async function pinnedCertificate(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBody) throw new Error('Invalid TLS certificate file');
  const pem = await readFile(path, 'utf8');
  return { pem, fingerprint: new X509Certificate(pem).fingerprint256 };
}

function collect(response: IncomingMessage): Promise<LocalResponse> {
  return new Promise((resolve, reject) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > maxBody) response.destroy(new Error('Local API response is too large'));
    });
    response.on('end', () => {
      resolve({ status: response.statusCode ?? 0, body });
    });
    response.on('error', reject);
  });
}

/**
 * Loopback requests of setup, update and owner tooling. With built-in HTTPS the connection is
 * verified against the configured certificate itself (trust anchor plus SHA-256 pin) instead of
 * a hostname: tooling dials 127.0.0.1 while the certificate names the public host. Verification
 * is never switched off.
 */
export async function localRequest(
  target: LocalTarget,
  path: string,
  options: LocalRequest,
): Promise<LocalResponse> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid local API path');
  const common = {
    host: target.host.replace(/^\[|\]$/g, ''),
    port: Number(target.port),
    path,
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    signal: AbortSignal.timeout(options.timeoutMs),
  };
  const pinned = target.certificateFile
    ? await pinnedCertificate(target.certificateFile)
    : undefined;
  return new Promise((resolve, reject) => {
    const handle = (response: IncomingMessage) => {
      collect(response).then(resolve, reject);
    };
    const call = pinned
      ? tlsRequest(
          {
            ...common,
            ca: pinned.pem,
            allowPartialTrustChain: true,
            checkServerIdentity: (_host, certificate) =>
              certificate.fingerprint256 === pinned.fingerprint
                ? undefined
                : new Error('Local API presented a certificate other than the configured one'),
          },
          handle,
        )
      : plainRequest(common, handle);
    call.on('error', reject);
    call.end(options.body);
  });
}

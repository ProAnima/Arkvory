import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { WebhookFailure } from '@proanima/arkvory-application';
import type {
  Cancellation,
  WebhookEvent,
  WebhookFailureCode,
  WebhookSender,
} from '@proanima/arkvory-application';
import { resolveReceiver } from './webhook-egress.js';
import type { EgressPolicy, Resolver } from './webhook-egress.js';
import { signWebhook } from './webhook-signature.js';

export interface HttpWebhookSenderOptions {
  readonly url: string;
  readonly policy: EgressPolicy;
  /** Secrets to sign with, read at each call so that a rotation needs no restart. */
  readonly secrets: () => Promise<readonly string[]>;
  readonly nowSeconds: () => number;
  readonly resolve?: Resolver;
  /** Extra certificate authorities of the receiver; TLS verification itself is never relaxed. */
  readonly ca?: readonly string[];
  /** Whole delivery: name resolution, connect, send, headers; 10 s by default. */
  readonly timeoutMs?: number;
}

const responseLimit = 4096;

function classify(error: unknown): WebhookFailureCode {
  if (error instanceof WebhookFailure) return error.code;
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (
    /^(CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH|ERR_SSL)/.test(code) ||
    /^ERR_OSSL/.test(code)
  )
    return 'tls';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  return 'network';
}

function outcome(status: number): WebhookFailureCode | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) return 'redirect';
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

/**
 * Posts events to one receiver (ADR 0069). The name is resolved and checked first and the
 * connection goes to that address (`lookup` returns it), so DNS cannot change the target between
 * check and connect. Redirects are failures, never followed. A response is read for at most
 * 4 KiB and discarded; nothing of it is kept or logged.
 */
export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly options: HttpWebhookSenderOptions) {}

  async send(event: WebhookEvent, cancellation: Cancellation): Promise<void> {
    cancellation.throwIfAborted();
    const url = new URL(this.options.url);
    // One budget for the whole delivery: what the lookup takes, the request no longer has.
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    const started = performance.now();
    const target = await resolveReceiver(
      url,
      this.options.policy,
      this.options.resolve,
      AbortSignal.timeout(timeoutMs),
    );
    const secrets = await this.options.secrets();
    const body = JSON.stringify(event);
    const timestamp = this.options.nowSeconds();
    const pinned: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const options: RequestOptions = {
      method: 'POST',
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port === '' ? undefined : Number(url.port),
      path: url.pathname,
      agent: false,
      lookup: pinned,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Arkvory-Webhook/1',
        'X-Arkvory-Delivery': event.id,
        'X-Arkvory-Event': event.action,
        'X-Arkvory-Timestamp': String(timestamp),
        'X-Arkvory-Signature': secrets
          .map((secret) => signWebhook(secret, timestamp, body))
          .join(','),
      },
      ...(url.protocol === 'https:' && this.options.ca ? { ca: [...this.options.ca] } : {}),
      // The name is only the TLS identity; the address was chosen above.
      ...(url.protocol === 'https:' ? { servername: url.hostname.replace(/^\[|\]$/g, '') } : {}),
    };
    const left = timeoutMs - (performance.now() - started);
    if (left <= 0) throw new WebhookFailure('timeout');
    const status = await this.post(url.protocol === 'https:', options, body, left);
    cancellation.throwIfAborted();
    const failure = outcome(status);
    if (failure !== null) throw new WebhookFailure(failure);
  }

  private post(
    secure: boolean,
    options: RequestOptions,
    body: string,
    timeoutMs: number,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const call = (secure ? httpsRequest : httpRequest)(options, (response: IncomingMessage) => {
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > responseLimit) response.destroy();
        });
        // Status is known from the first line; a body that breaks off later changes nothing.
        response.on('error', () => undefined);
        response.on('end', () => {
          clearTimeout(timer);
          resolve(response.statusCode ?? 0);
        });
        response.on('close', () => {
          clearTimeout(timer);
          resolve(response.statusCode ?? 0);
        });
      });
      const timer = setTimeout(() => {
        call.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      call.on('error', (error: unknown) => {
        clearTimeout(timer);
        reject(new WebhookFailure(classify(error)));
      });
      call.end(body);
    });
  }
}

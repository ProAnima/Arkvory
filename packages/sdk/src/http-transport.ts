import { readNativeError } from '@proanima/arkvory-contracts';
import {
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryNetworkError,
  retryAfter,
  readNetwork,
  releaseReader,
} from './transfer.js';
export interface HttpPort {
  request(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response>;
  json(response: Response, signal?: AbortSignal, maxBytes?: number): Promise<unknown>;
  call(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
}
/**
 * One finished HTTP exchange, reported when response headers arrive or the request fails.
 * Carries no headers, query string, body or credential; `path` is the URL path only.
 */
export interface RequestEvent {
  readonly method: string;
  readonly path: string;
  /** Absent when no response arrived (network failure or cancellation). */
  readonly status?: number;
  readonly durationMs: number;
  readonly requestId?: string;
}
export interface TransportOptions {
  readonly signal?: AbortSignal;
  readonly requestTimeoutMs?: number;
  /** Diagnostics only; an observer failure never affects the request. */
  readonly onRequest?: (event: RequestEvent) => void;
}
export function repositoryPath(repository: string, suffix: string) {
  return `api/v1/repositories/${encodeURIComponent(repository)}/${suffix}`;
}
// Error envelopes are small; a larger body is a proxy page and is not read further.
const maxErrorBytes = 64 * 1024;

/** One credential callback and HTTP boundary per public client; never cache a credential. */
export class HttpTransport implements HttpPort {
  private readonly base: URL;
  private readonly responseSignals = new WeakMap<Response, AbortSignal>();
  constructor(
    baseUrl: string,
    private readonly token: () => string,
    private readonly options: TransportOptions = {},
  ) {
    if (
      options.requestTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.requestTimeoutMs) ||
        options.requestTimeoutMs < 1 ||
        options.requestTimeoutMs > 3600000)
    )
      throw new ArkvoryClientError('invalid_argument', 'Invalid request timeout');
    this.base = new URL(baseUrl);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !(
        this.base.protocol === 'https:' ||
        (this.base.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname))
      )
    )
      throw new ArkvoryClientError('insecure_url', 'Use HTTPS (HTTP is allowed only on loopback)');
  }
  async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const deadline =
      signal ??
      (this.options.requestTimeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(this.options.requestTimeoutMs));
    const signals = [deadline, this.options.signal].filter(
      (value): value is AbortSignal => value !== undefined,
    );
    signal = signals.length ? AbortSignal.any(signals) : undefined;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token()}`);
    const url = new URL(
      path,
      this.base.href.endsWith('/') ? this.base : new URL(this.base.href + '/'),
    );
    const started = Date.now();
    const observe = (response?: Response) => {
      this.observe(init.method ?? 'GET', url, started, response);
    };
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }).catch(() => {
      observe();
      signal?.throwIfAborted();
      throw new ArkvoryNetworkError();
    });
    observe(response);
    if (signal) this.responseSignals.set(response, signal);
    if (!response.ok) throw await this.failure(response, signal);
    return response;
  }
  private observe(method: string, url: URL, started: number, response?: Response) {
    const observer = this.options.onRequest;
    if (!observer) return;
    const requestId = response?.headers.get('x-request-id') ?? undefined;
    try {
      observer({
        method: method.toUpperCase(),
        path: url.pathname,
        durationMs: Math.max(0, Date.now() - started),
        ...(response ? { status: response.status } : {}),
        ...(requestId ? { requestId } : {}),
      });
    } catch {
      // Diagnostics must not change request outcomes.
    }
  }
  /** Parses the native envelope; non-JSON proxies are reported without reflecting their body. */
  private async failure(response: Response, signal?: AbortSignal): Promise<ArkvoryHttpError> {
    const header = response.headers.get('x-request-id') ?? '';
    let parsed: ReturnType<typeof readNativeError> | undefined;
    try {
      parsed = readNativeError(await this.json(response, signal, maxErrorBytes));
    } catch {
      parsed = undefined;
    }
    signal?.throwIfAborted();
    const seconds = parsed?.retryAfterSeconds;
    const retryAfterMs =
      retryAfter(response.headers.get('retry-after')) ??
      (seconds === undefined ? undefined : seconds * 1000);
    return new ArkvoryHttpError(
      response.status,
      parsed?.code ?? 'http_error',
      parsed?.requestId || header,
      retryAfterMs,
      parsed
        ? {
            serverMessage: parsed.message,
            ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
            ...(parsed.details ? { details: parsed.details } : {}),
          }
        : {},
    );
  }
  async json(response: Response, signal?: AbortSignal, maxBytes = 2 * 1024 ** 2): Promise<unknown> {
    signal = this.responseSignals.get(response) ?? signal;
    if (!response.body) throw new ArkvoryClientError('invalid_response', 'Missing response body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await readNetwork(reader, signal);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes)
          throw new ArkvoryClientError('response_too_large', 'Response exceeds SDK limit');
        chunks.push(result.value);
      }
    } finally {
      await releaseReader(reader);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    return value;
  }
  async call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    return this.json(
      await this.request(
        path,
        {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        },
        signal,
      ),
      signal,
    );
  }
}

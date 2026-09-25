import { record, text } from '@proanima/depot-contracts';
import {
  DepotHttpError,
  DepotNetworkError,
  retryAfter,
  readNetwork,
  releaseReader,
} from './transfer.js';
export interface HttpPort {
  request(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response>;
  json(response: Response, signal?: AbortSignal, maxBytes?: number): Promise<unknown>;
  call(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
}
export function repositoryPath(repository: string, suffix: string) {
  return `api/v1/repositories/${encodeURIComponent(repository)}/${suffix}`;
}
/** One credential callback and HTTP boundary per public client; never cache a credential. */
export class HttpTransport implements HttpPort {
  private readonly base: URL;
  constructor(
    baseUrl: string,
    private readonly token: () => string,
  ) {
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
      throw new Error('Use HTTPS (HTTP is allowed only on loopback)');
  }
  async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token()}`);
    const response = await fetch(
      new URL(path, this.base.href.endsWith('/') ? this.base : new URL(this.base.href + '/')),
      {
        ...init,
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    ).catch(() => {
      signal?.throwIfAborted();
      throw new DepotNetworkError();
    });
    if (!response.ok) {
      let code = 'http_error',
        requestId = '';
      try {
        const value = record(await this.json(response, signal));
        code = text(value['code']);
        requestId = text(value['requestId']);
      } catch {
        /* Non-JSON proxies are reported without reflecting their response. */
      }
      signal?.throwIfAborted();
      throw new DepotHttpError(
        response.status,
        code,
        requestId,
        retryAfter(response.headers.get('retry-after')),
      );
    }
    return response;
  }
  async json(response: Response, signal?: AbortSignal, maxBytes = 2 * 1024 ** 2): Promise<unknown> {
    if (!response.body) throw new Error('Missing response body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await readNetwork(reader, signal);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes) throw new Error('Response exceeds SDK limit');
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

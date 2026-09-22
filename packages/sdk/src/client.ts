import {
  readUpload,
  readAnnotations,
  readJob,
  record,
  text,
  integer,
  items,
} from '@proanima/depot-contracts';
import type { UploadResponse, AnnotationsResponse } from '@proanima/depot-contracts';

export class DepotHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
  ) {
    super(`Depot request failed (${String(status)}, ${code})`);
  }
}
export class DepotClient {
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
  private path(repository: string, suffix: string) {
    return `api/v1/repositories/${encodeURIComponent(repository)}/${suffix}`;
  }
  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
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
    );
    if (!response.ok) {
      let code = 'http_error',
        requestId = '';
      try {
        const value = record(await this.json(response));
        code = text(value['code']);
        requestId = text(value['requestId']);
      } catch {
        /* Non-JSON proxies are reported without reflecting their response. */
      }
      throw new DepotHttpError(response.status, code, requestId);
    }
    return response;
  }
  private async json(response: Response): Promise<unknown> {
    if (!response.body) throw new Error('Missing response body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 2 * 1024 ** 2) throw new Error('Response exceeds SDK limit');
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
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
  private async call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
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
    );
  }
  async create(
    repository: string,
    key: string,
    descriptor: UploadResponse['descriptor'],
    signal?: AbortSignal,
  ) {
    return readUpload(
      await this.json(
        await this.request(
          this.path(repository, 'uploads'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(descriptor),
          },
          signal,
        ),
      ),
    );
  }
  async status(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async artifact(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `artifacts/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async list(repository: string, after?: string) {
    const r = record(
      await this.call(
        this.path(repository, `artifacts${after ? '?after=' + encodeURIComponent(after) : ''}`),
      ),
    );
    return {
      items: items(r['items']).map(readUpload),
      next: r['next'] === null ? null : text(r['next']),
    };
  }
  async search(
    repository: string,
    query: { q?: string; label?: string; collection?: string; after?: string } = {},
  ) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) q.set(key, value);
    const r = record(await this.call(this.path(repository, `search?${q.toString()}`)));
    return {
      items: items(r['items']).map((value) => {
        const i = record(value);
        return { id: text(i['id']), name: text(i['name']) };
      }),
      next: r['next'] === null ? null : text(r['next']),
    };
  }
  async annotations(repository: string, id: string) {
    return readAnnotations(
      await this.call(this.path(repository, `artifacts/${encodeURIComponent(id)}/annotations`)),
    );
  }
  async annotate(
    repository: string,
    id: string,
    expectedRevision: number,
    value: Omit<AnnotationsResponse, 'revision'>,
  ) {
    return readAnnotations(
      await this.call(
        this.path(repository, `artifacts/${encodeURIComponent(id)}/annotations`),
        'PUT',
        { expectedRevision, value },
      ),
    );
  }
  async parts(repository: string, id: string, signal?: AbortSignal) {
    const r = record(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/parts`),
        'GET',
        undefined,
        signal,
      ),
    );
    return {
      partBytes: integer(r['partBytes']),
      items: items(r['items']).map((value) => {
        const p = record(value);
        return { index: integer(p['index']), size: integer(p['size']), sha256: text(p['sha256']) };
      }),
    };
  }
  async complete(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/complete`),
        'POST',
        undefined,
        signal,
      ),
    );
  }
  async enqueue(repository: string, id: string) {
    return readJob(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/complete-async`),
        'POST',
      ),
    );
  }
  async job(id: string) {
    return readJob(await this.call(`api/v1/jobs/${encodeURIComponent(id)}`));
  }
  async registerPackage(repository: string, id: string) {
    return record(
      await this.call(this.path(repository, `artifacts/${encodeURIComponent(id)}/package`), 'POST'),
    );
  }
  async setAsset(repository: string, path: string, artifactId: string, expectedRevision: number) {
    return record(
      await this.call(this.path(repository, 'asset'), 'PUT', {
        path,
        artifactId,
        expectedRevision,
      }),
    );
  }
  async asset(repository: string, path: string) {
    const r = record(
      await this.call(this.path(repository, `asset?path=${encodeURIComponent(path)}`)),
    );
    return {
      path: text(r['path']),
      artifactId: text(r['artifactId']),
      revision: integer(r['revision']),
    };
  }
  async cancel(repository: string, id: string) {
    return readUpload(
      await this.call(this.path(repository, `uploads/${encodeURIComponent(id)}`), 'DELETE'),
    );
  }
  async download(
    repository: string,
    id: string,
    range?: { start: number; end: number },
    signal?: AbortSignal,
  ) {
    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start)
    )
      throw new Error('Invalid range');
    return this.request(
      this.path(repository, `artifacts/${encodeURIComponent(id)}/content`),
      { headers: range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {} },
      signal,
    );
  }
  async resume(
    repository: string,
    id: string,
    file: Blob,
    options: { signal?: AbortSignal; onProgress?: (bytes: number) => void } = {},
  ) {
    const upload = await this.status(repository, id, options.signal);
    if (Number(upload.descriptor.size) !== file.size)
      throw new Error('File size differs from upload');
    if (upload.status === 'available') return upload;
    if (upload.status !== 'pending') throw new Error('Upload is cancelled');
    if (file.size === 0)
      return readUpload(
        await this.json(
          await this.request(
            this.path(repository, `uploads/${encodeURIComponent(id)}/content`),
            { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
            options.signal,
          ),
        ),
      );
    const existing = await this.parts(repository, id, options.signal);
    if (existing.partBytes !== 8 * 1024 ** 2) throw new Error('Unsupported part size');
    for (let offset = 0, index = 0; offset < file.size; offset += existing.partBytes, index++) {
      options.signal?.throwIfAborted();
      const part = file.slice(offset, Math.min(file.size, offset + existing.partBytes));
      const digest = await crypto.subtle.digest('SHA-256', await part.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      const prior = existing.items.find((value) => value.index === index);
      if (prior && prior.sha256 !== sha256)
        throw new Error('Selected file does not match uploaded parts');
      if (!prior)
        await this.request(
          this.path(repository, `uploads/${encodeURIComponent(id)}/parts/${String(index)}`),
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256 },
            body: part,
          },
          options.signal,
        );
      options.onProgress?.(Math.min(file.size, offset + existing.partBytes));
    }
    return this.complete(repository, id, options.signal);
  }
}

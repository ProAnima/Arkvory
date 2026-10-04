import { readRawFile } from '@proanima/arkvory-contracts';
import type { RawFileResponse } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import { ArkvoryClientError } from './transfer.js';

/** The path of a raw file; each segment encoded, the slashes stay folders. */
function rawPath(repository: string, path: string) {
  return repositoryPath(repository, `raw/${path.split('/').map(encodeURIComponent).join('/')}`);
}

/**
 * Raw files by path (ADR 0064). One request per upload: for scripts and small to medium files.
 * Very large files belong to the resumable upload (create/resume) followed by setAsset.
 */
export class RawApi {
  constructor(private readonly http: HttpPort) {}

  /**
   * Stores `body` as the next revision of `path`; the same bytes again add none (`created`
   * false). With `sha256` the server streams straight to storage and refuses a mismatch;
   * `createOnly` refuses an existing path (409 already_exists).
   */
  async putRawFile(
    repository: string,
    path: string,
    body: Blob,
    options: { readonly sha256?: string; readonly createOnly?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<RawFileResponse> {
    if (options.sha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(options.sha256))
      throw new ArkvoryClientError('invalid_argument', 'Invalid SHA-256');
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (options.sha256 !== undefined) headers['X-Checksum-Sha256'] = options.sha256.toLowerCase();
    if (options.createOnly) headers['If-None-Match'] = '*';
    const response = await this.http.request(
      rawPath(repository, path),
      { method: 'PUT', headers, body },
      signal,
    );
    return readRawFile(await this.http.json(response, signal));
  }

  /** The current revision of `path`; `range` asks for part of it (206). */
  async downloadRawFile(
    repository: string,
    path: string,
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
      throw new ArkvoryClientError('invalid_argument', 'Invalid range');
    return this.http.request(
      rawPath(repository, path),
      { headers: range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {} },
      signal,
    );
  }
}

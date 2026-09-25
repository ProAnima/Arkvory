import { TransferAttempts } from './transfer.js';
import type { TransferOptions } from './transfer.js';
import { verifiedDownload } from './verified-download.js';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import type { transferPolicy } from './transfer.js';
import type { CatalogApi } from './catalog-api.js';

export class DownloadApi {
  constructor(
    private readonly http: HttpPort,
    private readonly policy: ReturnType<typeof transferPolicy>,
    private readonly catalog: Pick<CatalogApi, 'artifact'>,
  ) {}
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
    return this.http.request(
      repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/content`),
      { headers: range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {} },
      signal,
    );
  }
  /** A verified suffix stream. Supply an immutable saved prefix to resume after a process restart.
   * Commit the destination only when this stream closes successfully, never after the last write.
   */
  async downloadVerified(
    repository: string,
    id: string,
    options: TransferOptions & { prefix?: Blob } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const attempts = new TransferAttempts(this.policy, { ...options, signal });
    const artifact = await attempts.run((attemptSignal) =>
      this.catalog.artifact(repository, id, attemptSignal),
    );
    return verifiedDownload(
      artifact,
      options.prefix,
      attempts,
      signal,
      controller,
      (start, end, attemptSignal) =>
        this.http.request(
          repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/content`),
          {
            headers: {
              Range: `bytes=${String(start)}-${String(end)}`,
              'If-Range': `"sha256:${artifact.descriptor.sha256}"`,
            },
          },
          attemptSignal,
        ),
    );
  }
}

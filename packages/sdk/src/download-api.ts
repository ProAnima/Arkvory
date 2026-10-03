import { ArkvoryClientError, TransferAttempts } from './transfer.js';
import type { TransferOptions } from './transfer.js';
import { verifiedDownload } from './verified-download.js';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import type { transferPolicy } from './transfer.js';
import type { CatalogApi } from './catalog-api.js';
import { readDownloadLink } from '@proanima/arkvory-contracts';
import type { DownloadLinkResponse } from '@proanima/arkvory-contracts';

export class DownloadApi {
  constructor(
    private readonly http: HttpPort,
    private readonly policy: ReturnType<typeof transferPolicy>,
    private readonly catalog: Pick<CatalogApi, 'artifact'>,
    private readonly href: (path: string) => string = (path) => `/${path}`,
  ) {}
  /**
   * A link that downloads this artifact without a credential until `expiresAt` (ADR 0062): an
   * hour unless `ttlSeconds` (60 to 86400) says otherwise. `url` is absolute, under this
   * client's base URL; the token is a secret, shown once. Never retried automatically: each call
   * makes a new link.
   */
  async createDownloadLink(
    repository: string,
    id: string,
    options: { readonly ttlSeconds?: number } = {},
    signal?: AbortSignal,
  ): Promise<DownloadLinkResponse> {
    const link = readDownloadLink(
      await this.http.call(
        repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/links`),
        'POST',
        options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds },
        signal,
      ),
    );
    const content = repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/content`);
    return { ...link, url: `${this.href(content)}?token=${link.token}` };
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
      throw new ArkvoryClientError('invalid_argument', 'Invalid range');
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

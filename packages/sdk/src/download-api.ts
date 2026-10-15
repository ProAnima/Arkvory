import { ArkvoryClientError, ArkvoryHttpError, TransferAttempts, waitUntil } from './transfer.js';
import type { DownloadClass, TransferOptions } from './transfer.js';
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
   * Its ranges carry one Arkvory-Download-Id, so the server queues them as one download (ADR
   * 0076). Pass the same `downloadId` when resuming the same download, so it keeps its place
   * instead of queueing as another one; `downloadClass` may lower the class it queues in, e.g.
   * `bulk` for a mass update. The queue ticket the server sends is sent back with every further
   * range, so a server restart does not cost the download its turn; `queueTicket` passes one
   * saved by an earlier process. A window: nothing is asked before `notBefore`, and a download
   * the queue would start after `notAfter` ends with `queue_deadline` instead of waiting.
   */
  async downloadVerified(
    repository: string,
    id: string,
    options: TransferOptions & {
      prefix?: Blob;
      downloadId?: string;
      downloadClass?: DownloadClass;
      queueTicket?: string;
      notBefore?: Date;
      notAfter?: Date;
    } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    if (options.downloadId !== undefined && !downloadIdPattern.test(options.downloadId))
      throw new ArkvoryClientError('invalid_argument', 'Invalid download id');
    const queue = new QueueHeaders(
      options.downloadId ?? newDownloadId(),
      options.downloadClass,
      options.queueTicket,
      options.notAfter,
    );
    if (options.notBefore) await waitUntil(options.notBefore.getTime(), options.signal);
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
        queue.track(
          this.http.request(
            repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/content`),
            {
              headers: {
                Range: `bytes=${String(start)}-${String(end)}`,
                'If-Range': `"sha256:${artifact.descriptor.sha256}"`,
                ...queue.headers(),
              },
            },
            attemptSignal,
          ),
        ),
    );
  }
}

/** The form of Arkvory-Download-Id the server accepts. */
export const downloadIdPattern = /^[A-Za-z0-9_-]{16,64}$/;
/** A fresh id for one download: 32 hex characters. */
export function newDownloadId() {
  return crypto.randomUUID().replaceAll('-', '');
}

/** The queue headers of one download; keeps the newest ticket the server sent (ADR 0076). */
class QueueHeaders {
  constructor(
    private readonly id: string,
    private readonly downloadClass: DownloadClass | undefined,
    private ticket: string | undefined,
    private readonly notAfter: Date | undefined,
  ) {}

  headers(): Record<string, string> {
    return {
      'Arkvory-Download-Id': this.id,
      ...(this.downloadClass ? { 'Arkvory-Download-Class': this.downloadClass } : {}),
      ...(this.ticket ? { 'Arkvory-Queue-Ticket': this.ticket } : {}),
    };
  }

  async track(response: Promise<Response>): Promise<Response> {
    try {
      const answered = await response;
      this.ticket = answered.headers.get('arkvory-queue-ticket') ?? this.ticket;
      return answered;
    } catch (error) {
      if (error instanceof ArkvoryHttpError && error.queue) {
        this.ticket = error.queue.ticket ?? this.ticket;
        const start = error.queue.startsAt?.getTime() ?? Date.now();
        if (this.notAfter && Math.max(start, Date.now()) > this.notAfter.getTime())
          throw new ArkvoryClientError(
            'queue_deadline',
            `The download would start after ${this.notAfter.toISOString()}`,
          );
      }
      throw error;
    }
  }
}

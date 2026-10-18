import { ArkvoryClientError, ArkvoryHttpError, TransferAttempts, waitUntil } from './transfer.js';
import type { DownloadClass, TransferOptions } from './transfer.js';
import { readRange, verifiedDownload } from './verified-download.js';
import { extensionDownload } from './download-extension.js';
import { TransferExtensions } from './transfer-extensions.js';
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
    private readonly extensions: TransferExtensions = new TransferExtensions(http),
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
    const request = (start: number, end: number, attemptSignal: AbortSignal) =>
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
      );
    // A transfer extension may carry the bytes (ADR 0079, 5.2); they are verified all the same.
    const extension = await extensionDownload(this.extensions, {
      repository,
      artifactId: id,
      artifact,
      offset: options.prefix?.size ?? 0,
      signal,
      readRange: (start, end, rangeSignal) =>
        attempts.run(async (attemptSignal) =>
          readRange(
            await request(start, end, AbortSignal.any([rangeSignal, attemptSignal])),
            start,
            end,
            Number(artifact.descriptor.size),
            artifact.descriptor.sha256,
            attemptSignal,
          ),
        ),
    });
    return verifiedDownload(
      artifact,
      options.prefix,
      attempts,
      signal,
      controller,
      request,
      extension,
    );
  }
  /**
   * Bytes `start` to `end` of an artifact as a stream, in ranges of at most 8 MiB, each retried
   * on its own. Every answer must be exactly the asked range of the artifact with `sha256`
   * (ETag), otherwise `ArkvoryIntegrityError`; whether the bytes are the right ones for the
   * caller's purpose (an entry of an archive, say) the caller checks. One download id holds
   * the ranges together in the server's queue (ADR 0076), as with `downloadVerified`.
   */
  downloadRangeVerified(
    repository: string,
    id: string,
    options: RangeDownloadOptions,
  ): ReadableStream<Uint8Array> {
    const { start, end, sha256 } = options;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      (options.downloadId !== undefined && !downloadIdPattern.test(options.downloadId))
    )
      throw new ArkvoryClientError('invalid_argument', 'Invalid range');
    const queue = new QueueHeaders(
      options.downloadId ?? newDownloadId(),
      options.downloadClass,
      undefined,
      undefined,
    );
    const attempts = new TransferAttempts(this.policy, options);
    const path = repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/content`);
    let offset = start;
    return new ReadableStream<Uint8Array>(
      {
        pull: async (stream) => {
          try {
            options.signal?.throwIfAborted();
            const last = Math.min(end, offset + RANGE_CHUNK - 1);
            const bytes = await attempts.run(async (signal) => {
              const response = await queue.track(
                this.http.request(
                  path,
                  {
                    headers: {
                      Range: `bytes=${String(offset)}-${String(last)}`,
                      'If-Range': `"sha256:${sha256}"`,
                      ...queue.headers(),
                    },
                  },
                  signal,
                ),
              );
              const total = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1];
              return readRange(response, offset, last, Number(total ?? -1), sha256, signal);
            });
            offset = last + 1;
            stream.enqueue(bytes);
            if (offset > end) stream.close();
          } catch (error) {
            stream.error(error);
          }
        },
      },
      { highWaterMark: 0 },
    );
  }
}

/** Options of a verified range of one artifact (`downloadRangeVerified`). */
export interface RangeDownloadOptions extends TransferOptions {
  /** First and last byte, inclusive. */
  readonly start: number;
  readonly end: number;
  /** The artifact's SHA-256: every response must carry its ETag, so all bytes are of it. */
  readonly sha256: string;
  /** One id for every range of one logical download, so the server queues them as one. */
  readonly downloadId?: string;
  readonly downloadClass?: DownloadClass;
}

const RANGE_CHUNK = 8 * 1024 ** 2;

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

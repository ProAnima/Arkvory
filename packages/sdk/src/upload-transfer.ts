import { readUpload } from '@proanima/arkvory-contracts';
import { ArkvoryClientError, TransferAttempts, delay } from './transfer.js';
import type { TransferOptions } from './transfer.js';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import type { transferPolicy } from './transfer.js';
import type { UploadsApi } from './uploads-api.js';

const MIN_PART_BYTES = 8 * 1024 ** 2;
const MAX_PART_BYTES = 1024 ** 3;
/** Above this size assembly may outlive one request; the worker completes it durably instead. */
export const ASYNC_COMPLETION_BYTES = 16 * 1024 ** 3;

export class UploadTransfer {
  constructor(
    private readonly http: HttpPort,
    private readonly policy: ReturnType<typeof transferPolicy>,
    private readonly uploads: Pick<UploadsApi, 'status' | 'parts' | 'complete' | 'enqueue' | 'job'>,
  ) {}
  async resume(
    repository: string,
    id: string,
    file: Blob,
    options: TransferOptions & { onProgress?: (bytes: number) => void } = {},
  ) {
    const attempts = new TransferAttempts(this.policy, options);
    const upload = await attempts.run((signal) => this.uploads.status(repository, id, signal));
    if (Number(upload.descriptor.size) !== file.size)
      throw new ArkvoryClientError('size_mismatch', 'File size differs from upload');
    if (upload.status === 'available') return upload;
    if (upload.status !== 'pending')
      throw new ArkvoryClientError('upload_cancelled', 'Upload is cancelled');
    if (file.size === 0)
      return attempts.run(async (signal) => {
        // PUT /content is not replayed after publication; reconcile a lost response first.
        const current = await this.uploads.status(repository, id, signal);
        if (current.status === 'available') return current;
        return readUpload(
          await this.http.json(
            await this.http.request(
              repositoryPath(repository, `uploads/${encodeURIComponent(id)}/content`),
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file,
              },
              signal,
            ),
            signal,
          ),
        );
      });
    const existing = await attempts.run((signal) => this.uploads.parts(repository, id, signal));
    const { partBytes } = existing;
    if (
      !Number.isSafeInteger(partBytes) ||
      partBytes < MIN_PART_BYTES ||
      partBytes > MAX_PART_BYTES ||
      partBytes % MIN_PART_BYTES !== 0
    )
      throw new ArkvoryClientError('invalid_response', 'Unsupported part size');
    const indices = new Set<number>();
    if (existing.items.length > Math.ceil(file.size / existing.partBytes))
      throw new ArkvoryClientError('invalid_response', 'Invalid server parts');
    for (const part of existing.items) {
      if (
        indices.has(part.index) ||
        part.index >= Math.ceil(file.size / existing.partBytes) ||
        part.size !== Math.min(existing.partBytes, file.size - part.index * existing.partBytes) ||
        !/^[a-f0-9]{64}$/.test(part.sha256)
      )
        throw new ArkvoryClientError('invalid_response', 'Invalid server parts');
      indices.add(part.index);
    }
    for (let offset = 0, index = 0; offset < file.size; offset += existing.partBytes, index++) {
      options.signal?.throwIfAborted();
      const part = file.slice(offset, Math.min(file.size, offset + existing.partBytes));
      const digest = await crypto.subtle.digest('SHA-256', await part.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      const prior = existing.items.find((value) => value.index === index);
      if (prior && prior.sha256 !== sha256)
        throw new ArkvoryClientError('file_changed', 'Selected file does not match uploaded parts');
      if (!prior)
        await attempts.run(async (signal) => {
          const response = await this.http.request(
            repositoryPath(repository, `uploads/${encodeURIComponent(id)}/parts/${String(index)}`),
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256 },
              body: part,
            },
            signal,
          );
          await response.body?.cancel();
        });
      options.onProgress?.(Math.min(file.size, offset + existing.partBytes));
    }
    // Assembly may be substantially slower than one bounded part transfer.
    if (file.size < ASYNC_COMPLETION_BYTES)
      return attempts.run((signal) => this.uploads.complete(repository, id, signal), 1_800_000);
    return completeWithWorker(this.uploads, attempts, repository, id, options.signal);
  }
}

/** Waits for the worker; the job is keyed by upload, so a repeated enqueue returns the same job. */
export async function completeWithWorker(
  uploads: Pick<UploadsApi, 'status' | 'enqueue' | 'job'>,
  attempts: Pick<TransferAttempts, 'run'>,
  repository: string,
  id: string,
  signal: AbortSignal | undefined,
  pollMs = 1000,
) {
  const job = await attempts.run(() => uploads.enqueue(repository, id));
  for (let wait = pollMs; ; wait = Math.min(wait * 2, 15 * pollMs)) {
    const current = await attempts.run(() => uploads.job(job.id));
    if (current.status === 'completed')
      return attempts.run((s) => uploads.status(repository, id, s));
    if (current.status === 'failed')
      throw new ArkvoryClientError(
        'completion_failed',
        `Upload completion failed: ${current.errorCode ?? 'unknown'}`,
        current.errorCode ?? undefined,
      );
    await delay(wait, signal);
  }
}

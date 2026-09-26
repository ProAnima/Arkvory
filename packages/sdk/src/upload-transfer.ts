import { readUpload } from '@proanima/arkvory-contracts';
import { TransferAttempts } from './transfer.js';
import type { TransferOptions } from './transfer.js';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import type { transferPolicy } from './transfer.js';
import type { UploadsApi } from './uploads-api.js';

export class UploadTransfer {
  constructor(
    private readonly http: HttpPort,
    private readonly policy: ReturnType<typeof transferPolicy>,
    private readonly uploads: Pick<UploadsApi, 'status' | 'parts' | 'complete'>,
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
      throw new Error('File size differs from upload');
    if (upload.status === 'available') return upload;
    if (upload.status !== 'pending') throw new Error('Upload is cancelled');
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
    if (existing.partBytes !== 8 * 1024 ** 2) throw new Error('Unsupported part size');
    const indices = new Set<number>();
    if (existing.items.length > Math.ceil(file.size / existing.partBytes))
      throw new Error('Invalid server parts');
    for (const part of existing.items) {
      if (
        indices.has(part.index) ||
        part.index >= Math.ceil(file.size / existing.partBytes) ||
        part.size !== Math.min(existing.partBytes, file.size - part.index * existing.partBytes) ||
        !/^[a-f0-9]{64}$/.test(part.sha256)
      )
        throw new Error('Invalid server parts');
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
        throw new Error('Selected file does not match uploaded parts');
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
    return attempts.run((signal) => this.uploads.complete(repository, id, signal), 1_800_000);
  }
}

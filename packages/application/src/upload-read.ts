import {
  ArkvoryError,
  authorizeAction,
  PART_BYTES,
  requireId,
  requireRepository,
} from '@proanima/arkvory-domain';
import type { Principal, Upload, UploadPart } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation, Catalog } from './ports.js';
import type { ContentPinning } from './catalog-read.js';
import { partsBackendOf } from './staged-completion.js';

export interface UploadByteRange {
  readonly start: number;
  readonly end: number;
}

export function requireUploadRange(range: UploadByteRange): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start
  )
    throw new ArkvoryError('invalid_input', 'Invalid upload range');
}

/** Request-scoped reads of accepted parts; the pin must lock the upload key, not content. */
export class ScopedUploads {
  constructor(
    private readonly catalog: Pick<Catalog, 'get' | 'parts'>,
    private readonly blobs: Pick<BlobStore, 'readParts'>,
    private readonly pins: ContentPinning,
    private readonly now: () => string,
  ) {}

  async upload(
    principals: readonly Principal[],
    repository: string,
    id: string,
  ): Promise<Upload | null> {
    requireRepository(repository);
    requireId(id);
    if (!principals.length) return null;
    try {
      for (const principal of principals)
        authorizeAction(principal, repository, 'upload.read', ['write']);
      const upload = await this.catalog.get(repository, id);
      return upload.status === 'pending' &&
        upload.expiresAt > this.now() &&
        principals.every((p) => p.id === upload.owner)
        ? upload
        : null;
    } catch (error) {
      if (
        error instanceof ArkvoryError &&
        (error.code === 'not_found' || error.code === 'forbidden')
      )
        return null;
      throw error;
    }
  }

  async *read(
    principals: readonly Principal[],
    repository: string,
    id: string,
    range: UploadByteRange,
    cancellation: Cancellation,
  ): AsyncIterable<Uint8Array> {
    requireUploadRange(range);
    cancellation.throwIfAborted();
    if (!(await this.upload(principals, repository, id))) return;
    cancellation.throwIfAborted();
    const pin = await this.pins.acquire(id);
    try {
      cancellation.throwIfAborted();
      const upload = await this.upload(principals, repository, id);
      if (!upload) return;
      if (range.end >= upload.descriptor.size)
        throw new ArkvoryError('invalid_input', 'Range outside upload');
      const width = upload.partBytes ?? PART_BYTES;
      const parts = covered(await this.catalog.parts(id), range, width);
      let offset = (parts[0]?.index ?? 0) * width;
      for await (const chunk of this.blobs.readParts(id, parts, partsBackendOf(upload))) {
        cancellation.throwIfAborted();
        pin.check();
        const start = Math.max(0, range.start - offset);
        const end = Math.min(chunk.byteLength, range.end - offset + 1);
        offset += chunk.byteLength;
        if (end > start) yield chunk.subarray(start, end);
        cancellation.throwIfAborted();
        pin.check();
        if (offset > range.end) return;
      }
      if (offset <= range.end)
        throw new ArkvoryError('integrity_mismatch', 'Accepted parts are short');
    } finally {
      await pin.release();
    }
  }
}

function covered(
  parts: readonly UploadPart[],
  range: UploadByteRange,
  width: number,
): readonly UploadPart[] {
  const first = Math.floor(range.start / width),
    last = Math.floor(range.end / width);
  const selected = parts
    .filter((part) => part.index >= first && part.index <= last)
    .sort((a, b) => a.index - b.index);
  if (selected.length !== last - first + 1 || selected.some((part, i) => part.index !== first + i))
    throw new ArkvoryError('conflict', 'Range includes unreceived parts');
  return selected;
}

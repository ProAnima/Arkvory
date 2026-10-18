import {
  authorizeAction,
  ArkvoryError,
  parseDescriptor,
  requireId,
  partSize,
  partBytesFor,
  checkParts,
  MAX_OBJECT_BYTES,
  PART_BYTES,
} from '@proanima/arkvory-domain';
import type { Principal, Upload } from '@proanima/arkvory-domain';
import { DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import type {
  BlobStore,
  Cancellation,
  Catalog,
  IdentitySource,
  StagedParts,
  UploadMutation,
} from './ports.js';
import type { UploadPlacement } from './storage-placement.js';
import { completeFromParts, partsBackendOf } from './staged-completion.js';

export { partsBackendOf };

export interface StorageOptions {
  /** Storage of new uploads (ADR 0083, N11); without it everything stays in `default`. */
  readonly placement?: UploadPlacement;
  /** Operator ceiling; the multipart layout limit applies when omitted. */
  readonly maxObjectBytes?: number;
  /** Storages that assemble objects from their accepted parts (ADR 0083, N1). */
  readonly staged?: StagedParts;
}

export class StorageService {
  private readonly placement: UploadPlacement | undefined;
  private readonly staged: StagedParts | undefined;
  readonly maxObjectBytes: number;
  constructor(
    private readonly catalog: Catalog,
    private readonly blobs: BlobStore,
    private readonly identity: IdentitySource,
    options: StorageOptions = {},
  ) {
    this.placement = options.placement;
    this.staged = options.staged;
    this.maxObjectBytes = Math.min(options.maxObjectBytes ?? MAX_OBJECT_BYTES, MAX_OBJECT_BYTES);
  }

  async create(
    principal: Principal,
    repository: string,
    key: string,
    descriptor: unknown,
    group?: string,
  ): Promise<Upload> {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key))
      throw new ArkvoryError('invalid_input', 'Invalid Idempotency-Key');
    const parsed = parseDescriptor(descriptor);
    if (parsed.size > this.maxObjectBytes)
      throw new ArkvoryError('invalid_input', 'Object exceeds the configured maximum size');
    const resolvedGroup = group ?? parsed.metadata['upack.group'] ?? parsed.metadata['group'];
    const storageBackend = this.placement
      ? (
          await this.placement.place({
            repository,
            packageGroup: typeof resolvedGroup === 'string' ? resolvedGroup : undefined,
            size: parsed.size,
          })
        ).backendId
      : DEFAULT_STORAGE_BACKEND;
    return this.catalog.create({
      id: this.identity.next(),
      repository,
      owner: principal.id,
      key,
      descriptor: parsed,
      createdAt: this.identity.now(),
      storageBackend,
      partBytes: partBytesFor(parsed.size),
      access: { principal, repository, actions: ['upload.create'] },
    });
  }

  async upload(
    principal: Principal,
    repository: string,
    id: string,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<Upload> {
    authorizeAction(principal, repository, 'upload.write', ['write']);
    authorizeAction(principal, repository, 'upload.complete', ['write']);
    requireId(id);
    return this.catalog.exclusive(
      id,
      async (mutation) => {
        let upload = await this.owned(principal, repository, id);
        this.pending(upload);
        if ((await this.catalog.parts(id)).length > 0)
          throw new ArkvoryError('conflict', 'Multipart upload must be completed using its parts', {
            reason: 'upload_state',
          });
        // A storage that stopped taking data is left before the first byte, by a pending-row
        // change, never by moving bytes. Not when it already holds the whole object from an
        // attempt that stopped before publication: that object would lose its owner, so the
        // write goes there again and finds it.
        if (this.refuses(upload.storageBackend) && !(await this.holds(upload)))
          upload = await mutation.relocate(DEFAULT_STORAGE_BACKEND, null);
        await this.blobs.put(
          id,
          upload.descriptor,
          source,
          {
            throwIfAborted() {
              cancellation.throwIfAborted();
              mutation.throwIfAborted();
            },
          },
          upload.storageBackend,
        );
        cancellation.throwIfAborted();
        return mutation.publish(repository);
      },
      { principal, repository, actions: ['upload.write', 'upload.complete'] },
    );
  }

  async complete(
    principal: Principal,
    repository: string,
    id: string,
    cancellation: Cancellation,
  ): Promise<Upload> {
    authorizeAction(principal, repository, 'upload.complete', ['write']);
    requireId(id);
    return this.catalog.exclusive(
      id,
      async (mutation) => {
        let upload = await this.owned(principal, repository, id);
        if (upload.status === 'available') return upload;
        if (upload.status === 'cancelled')
          throw new ArkvoryError('conflict', 'Upload is cancelled', { reason: 'upload_state' });
        this.pending(upload);
        const parts = await this.catalog.parts(id);
        // An attempt that wrote the whole object and stopped before publication: the storage
        // keeps it, even one that takes no new data now, and it is only verified again.
        let held =
          parts.length > 0 && this.refuses(upload.storageBackend) && (await this.holds(upload));
        if (parts.length > 0 && !held) {
          checkParts(upload.descriptor.size, parts, upload.partBytes ?? PART_BYTES);
          // ADR 0083, N11: accepted parts stay readable where they are; the object is written
          // to the core's storage. The switch is recorded before the write, so a retry after a
          // crash writes to the same storage and leaves no object behind in the other one.
          if (this.refuses(upload.storageBackend))
            upload = await mutation.relocate(DEFAULT_STORAGE_BACKEND, partsBackendOf(upload));
          const check = guarded(cancellation, mutation);
          let composed = await completeFromParts(this.staged, upload, parts, check);
          // A storage that turned read-only after committing the object keeps it: verified
          // below and published there, never written again elsewhere and left without owner.
          if (composed === 'refused' && (await this.holds(upload))) {
            held = true;
            composed = 'committed';
          }
          if (composed === 'refused')
            upload = await mutation.relocate(DEFAULT_STORAGE_BACKEND, partsBackendOf(upload));
          if (composed === 'skipped' || composed === 'refused')
            await this.blobs.put(
              id,
              upload.descriptor,
              this.blobs.readParts(id, parts, partsBackendOf(upload)),
              check,
              upload.storageBackend,
            );
        }
        if (parts.length === 0 || held)
          await this.blobs.verify(
            id,
            upload.descriptor,
            {
              throwIfAborted() {
                cancellation.throwIfAborted();
                mutation.throwIfAborted();
              },
            },
            upload.storageBackend,
          );
        cancellation.throwIfAborted();
        return mutation.publish(repository);
      },
      { principal, repository, actions: ['upload.complete'] },
    );
  }

  async cancel(principal: Principal, repository: string, id: string): Promise<Upload> {
    authorizeAction(principal, repository, 'upload.cancel', ['write']);
    requireId(id);
    return this.catalog.exclusive(
      id,
      async (mutation) => {
        const upload = await this.owned(principal, repository, id);
        if (upload.status === 'available')
          throw new ArkvoryError('conflict', 'Published artifacts cannot be cancelled', {
            reason: 'upload_state',
          });
        // Cancellation hides content. Physical reclamation needs a separately fenced GC.
        return mutation.cancel(repository);
      },
      { principal, repository, actions: ['upload.cancel'] },
    );
  }

  async parts(principal: Principal, repository: string, id: string) {
    const upload = await this.status(principal, repository, id);
    return { partBytes: upload.partBytes ?? PART_BYTES, items: await this.catalog.parts(id) };
  }

  async uploadPart(
    principal: Principal,
    repository: string,
    id: string,
    index: number,
    sha256: string,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    authorizeAction(principal, repository, 'upload.write', ['write']);
    requireId(id);
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new ArkvoryError('invalid_input', 'Invalid part checksum');
    await this.catalog.exclusive(
      id,
      async (mutation) => {
        const upload = await this.owned(principal, repository, id);
        this.pending(upload);
        const part = {
          index,
          size: partSize(upload.descriptor.size, index, upload.partBytes ?? PART_BYTES),
          sha256,
        };
        // Point lookup keeps a 10000-part upload linear instead of rereading every part per request.
        const existing = await this.catalog.part(id, index);
        if (existing && existing.sha256 !== sha256)
          throw new ArkvoryError('conflict', 'Part already has different content', {
            reason: 'part_mismatch',
          });
        // Parts of one upload stay in one storage; the client starts a new upload instead.
        if (this.refuses(partsBackendOf(upload)))
          throw new ArkvoryError('conflict', 'The storage of this upload takes no new data', {
            reason: 'backend_read_only',
          });
        await this.blobs.putPart(
          id,
          part,
          source,
          {
            throwIfAborted() {
              cancellation.throwIfAborted();
              mutation.throwIfAborted();
            },
          },
          partsBackendOf(upload),
        );
        await mutation.recordPart(part);
      },
      { principal, repository, actions: ['upload.write'] },
    );
  }

  /**
   * Whether the upload's storage durably refuses new data now. A storage that is only
   * `unavailable` is not: the write fails with `unavailable` and is retried, rather than
   * switching storage over a passing outage. The core's storage never refuses here.
   */
  private refuses(backendId: string | undefined): boolean {
    const id = backendId ?? DEFAULT_STORAGE_BACKEND;
    if (!this.placement || id === DEFAULT_STORAGE_BACKEND) return false;
    const state = this.placement.state(id);
    return state !== 'accepting' && state !== 'unavailable';
  }

  /** Whether the upload's own storage already holds its whole object; any failure is no. */
  private async holds(upload: Upload): Promise<boolean> {
    try {
      await this.blobs.exists(upload.id, upload.descriptor.size, upload.storageBackend);
      return true;
    } catch {
      return false;
    }
  }

  private pending(upload: Upload): void {
    if (upload.status !== 'pending')
      throw new ArkvoryError('conflict', 'Upload is not pending', { reason: 'upload_state' });
    if (upload.expiresAt <= this.identity.now())
      throw new ArkvoryError('conflict', 'Upload has expired', { reason: 'upload_expired' });
  }

  async status(principal: Principal, repository: string, id: string): Promise<Upload> {
    authorizeAction(principal, repository, 'upload.read', ['write']);
    return this.owned(principal, repository, requireId(id));
  }

  async artifact(
    principal: Principal,
    repository: string,
    id: string,
    permission: 'artifact.read' | 'annotation.read' | 'content.read' = 'artifact.read',
  ): Promise<Upload> {
    authorizeAction(principal, repository, permission, ['read']);
    const upload = await this.catalog.get(repository, requireId(id));
    if (upload.status !== 'available') throw new ArkvoryError('not_found', 'Artifact not found');
    return upload;
  }

  async list(
    principal: Principal,
    repository: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly Upload[]> {
    authorizeAction(principal, repository, 'artifact.list', ['read']);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ArkvoryError('invalid_input', 'Invalid page limit');
    if (after !== undefined) requireId(after);
    return this.catalog.list(repository, after, limit);
  }

  async download(
    principal: Principal,
    repository: string,
    id: string,
  ): Promise<{
    upload: Upload;
    read: (range?: { start: number; end: number }) => AsyncIterable<Uint8Array>;
  }> {
    const upload = await this.artifact(principal, repository, id, 'content.read');
    await this.blobs.exists(id, upload.descriptor.size, upload.storageBackend);
    return {
      upload,
      read: (range) => this.blobs.read(id, upload.descriptor.size, range, upload.storageBackend),
    };
  }

  private async owned(principal: Principal, repository: string, id: string): Promise<Upload> {
    const upload = await this.catalog.get(repository, id);
    if (upload.owner !== principal.id) throw new ArkvoryError('not_found', 'Upload not found');
    return upload;
  }
}

/** Cancellation of a request together with the loss of the upload's lock. */
function guarded(cancellation: Cancellation, mutation: UploadMutation): Cancellation {
  return {
    throwIfAborted() {
      cancellation.throwIfAborted();
      mutation.throwIfAborted();
    },
  };
}

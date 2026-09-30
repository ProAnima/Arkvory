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
import type { BlobStore, Cancellation, Catalog, IdentitySource } from './ports.js';

export interface StorageRouter {
  resolveBackend(context: {
    repository: string;
    packageGroup?: string | undefined;
    size: number;
  }): string;
}

export interface StorageOptions {
  readonly router?: StorageRouter;
  /** Operator ceiling; the multipart layout limit applies when omitted. */
  readonly maxObjectBytes?: number;
}

export class StorageService {
  private readonly router: StorageRouter | undefined;
  readonly maxObjectBytes: number;
  constructor(
    private readonly catalog: Catalog,
    private readonly blobs: BlobStore,
    private readonly identity: IdentitySource,
    options: StorageOptions = {},
  ) {
    this.router = options.router;
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
    const storageBackend = this.router
      ? this.router.resolveBackend({
          repository,
          packageGroup: typeof resolvedGroup === 'string' ? resolvedGroup : undefined,
          size: parsed.size,
        })
      : 'default';
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
        const upload = await this.owned(principal, repository, id);
        this.pending(upload);
        if ((await this.catalog.parts(id)).length > 0)
          throw new ArkvoryError('conflict', 'Multipart upload must be completed using its parts');
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
        const upload = await this.owned(principal, repository, id);
        if (upload.status === 'available') return upload;
        if (upload.status === 'cancelled')
          throw new ArkvoryError('conflict', 'Upload is cancelled');
        this.pending(upload);
        const parts = await this.catalog.parts(id);
        if (parts.length > 0) {
          checkParts(upload.descriptor.size, parts, upload.partBytes ?? PART_BYTES);
          await this.blobs.put(
            id,
            upload.descriptor,
            this.blobs.readParts(id, parts, upload.storageBackend),
            {
              throwIfAborted() {
                cancellation.throwIfAborted();
                mutation.throwIfAborted();
              },
            },
            upload.storageBackend,
          );
        }
        if (parts.length === 0)
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
          throw new ArkvoryError('conflict', 'Published artifacts cannot be cancelled');
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
          throw new ArkvoryError('conflict', 'Part already has different content');
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
          upload.storageBackend,
        );
        await mutation.recordPart(part);
      },
      { principal, repository, actions: ['upload.write'] },
    );
  }

  private pending(upload: Upload): void {
    if (upload.status !== 'pending') throw new ArkvoryError('conflict', 'Upload is not pending');
    if (upload.expiresAt <= this.identity.now())
      throw new ArkvoryError('conflict', 'Upload has expired');
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

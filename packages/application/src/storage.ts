import { authorize, DepotError, parseDescriptor, requireId } from '@proanima/depot-domain';
import type { Principal, Upload } from '@proanima/depot-domain';
import type { BlobStore, Cancellation, Catalog, IdentitySource } from './ports.js';

export class StorageService {
  constructor(
    private readonly catalog: Catalog,
    private readonly blobs: BlobStore,
    private readonly identity: IdentitySource,
  ) {}

  async create(
    principal: Principal,
    repository: string,
    key: string,
    descriptor: unknown,
  ): Promise<Upload> {
    authorize(principal, repository, 'write');
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key))
      throw new DepotError('invalid_input', 'Invalid Idempotency-Key');
    return this.catalog.create({
      id: this.identity.next(),
      repository,
      owner: principal.id,
      key,
      descriptor: parseDescriptor(descriptor),
      createdAt: this.identity.now(),
    });
  }

  async upload(
    principal: Principal,
    repository: string,
    id: string,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<Upload> {
    authorize(principal, repository, 'write');
    requireId(id);
    return this.catalog.exclusive(id, async (mutation) => {
      const upload = await this.owned(principal, repository, id);
      if (upload.status !== 'pending')
        throw new DepotError(
          'conflict',
          'Content can only be sent to a pending upload; query its status',
        );
      await this.blobs.put(id, upload.descriptor, source, {
        throwIfAborted() {
          cancellation.throwIfAborted();
          mutation.throwIfAborted();
        },
      });
      cancellation.throwIfAborted();
      return mutation.publish(repository);
    });
  }

  async complete(
    principal: Principal,
    repository: string,
    id: string,
    cancellation: Cancellation,
  ): Promise<Upload> {
    authorize(principal, repository, 'write');
    requireId(id);
    return this.catalog.exclusive(id, async (mutation) => {
      const upload = await this.owned(principal, repository, id);
      if (upload.status === 'available') return upload;
      if (upload.status === 'cancelled') throw new DepotError('conflict', 'Upload is cancelled');
      await this.blobs.verify(id, upload.descriptor, {
        throwIfAborted() {
          cancellation.throwIfAborted();
          mutation.throwIfAborted();
        },
      });
      cancellation.throwIfAborted();
      return mutation.publish(repository);
    });
  }

  async cancel(principal: Principal, repository: string, id: string): Promise<Upload> {
    authorize(principal, repository, 'write');
    requireId(id);
    return this.catalog.exclusive(id, async (mutation) => {
      const upload = await this.owned(principal, repository, id);
      if (upload.status === 'available')
        throw new DepotError('conflict', 'Published artifacts cannot be cancelled');
      // Cancellation hides content. Physical reclamation needs a separately fenced GC.
      return mutation.cancel(repository);
    });
  }

  async status(principal: Principal, repository: string, id: string): Promise<Upload> {
    authorize(principal, repository, 'write');
    return this.owned(principal, repository, requireId(id));
  }

  async artifact(principal: Principal, repository: string, id: string): Promise<Upload> {
    authorize(principal, repository, 'read');
    const upload = await this.catalog.get(repository, requireId(id));
    if (upload.status !== 'available') throw new DepotError('not_found', 'Artifact not found');
    return upload;
  }

  async list(
    principal: Principal,
    repository: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly Upload[]> {
    authorize(principal, repository, 'read');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new DepotError('invalid_input', 'Invalid page limit');
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
    const upload = await this.artifact(principal, repository, id);
    await this.blobs.exists(id, upload.descriptor.size);
    return { upload, read: (range) => this.blobs.read(id, upload.descriptor.size, range) };
  }

  private async owned(principal: Principal, repository: string, id: string): Promise<Upload> {
    const upload = await this.catalog.get(repository, id);
    if (upload.owner !== principal.id) throw new DepotError('not_found', 'Upload not found');
    return upload;
  }
}

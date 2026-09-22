import type { ArtifactDescriptor, Upload } from '@proanima/depot-domain';

// Portable cancellation contract: core does not depend on DOM or Node globals.
export interface Cancellation {
  throwIfAborted(): void;
}
export interface Catalog {
  create(input: {
    id: string;
    repository: string;
    owner: string;
    key: string;
    descriptor: ArtifactDescriptor;
    createdAt: string;
  }): Promise<Upload>;
  get(repository: string, id: string): Promise<Upload>;
  list(repository: string, after: string | undefined, limit: number): Promise<readonly Upload[]>;
  exclusive<T>(id: string, action: (mutation: UploadMutation) => Promise<T>): Promise<T>;
}

export interface UploadMutation extends Cancellation {
  publish(repository: string): Promise<Upload>;
  cancel(repository: string): Promise<Upload>;
}

export interface BlobStore {
  // Immutable publication; existing blobs are verified before retry succeeds.
  put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void>;
  verify(id: string, expected: ArtifactDescriptor, cancellation: Cancellation): Promise<void>;
  read(id: string, size: number, range?: { start: number; end: number }): AsyncIterable<Uint8Array>;
  exists(id: string, size: number): Promise<void>;
}

export interface IdentitySource {
  next(): string;
  now(): string;
}

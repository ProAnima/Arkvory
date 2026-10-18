import type {
  ArtifactDescriptor,
  Upload,
  UploadPart,
  MutationAccess,
} from '@proanima/arkvory-domain';

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
    storageBackend?: string;
    partBytes: number;
    access?: MutationAccess;
  }): Promise<Upload>;
  get(repository: string, id: string): Promise<Upload>;
  parts(id: string): Promise<readonly UploadPart[]>;
  part(id: string, index: number): Promise<UploadPart | null>;
  list(repository: string, after: string | undefined, limit: number): Promise<readonly Upload[]>;
  exclusive<T>(
    id: string,
    action: (mutation: UploadMutation) => Promise<T>,
    access?: MutationAccess,
  ): Promise<T>;
}

export interface UploadMutation extends Cancellation {
  recordPart(part: UploadPart): Promise<void>;
  publish(repository: string): Promise<Upload>;
  /**
   * Moves a pending upload to another storage before any byte of its object is written there
   * (ADR 0083, N11); `partsBackend` names where its accepted parts stay, null when it has none.
   * Only a pending upload; bytes are never moved.
   */
  relocate(storageBackend: string, partsBackend: string | null): Promise<Upload>;
  cancel(repository: string): Promise<Upload>;
}

export interface BlobStore {
  putPart(
    id: string,
    part: UploadPart,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
  readParts(
    id: string,
    parts: readonly UploadPart[],
    backendId?: string,
  ): AsyncIterable<Uint8Array>;
  // Immutable publication; existing blobs are verified before retry succeeds.
  put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
  verify(
    id: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
  read(
    id: string,
    size: number,
    range?: { start: number; end: number },
    backendId?: string,
  ): AsyncIterable<Uint8Array>;
  exists(id: string, size: number, backendId?: string): Promise<void>;
  /** Shares published immutable bytes under a new id without copying them; checks the size. */
  duplicate(
    sourceId: string,
    targetId: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
  collect?(
    id: string,
    removeContent: boolean,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
}

/**
 * Completion from parts a storage already accepted (ADR 0083, N1). A storage that cannot
 * assemble an object on its side has no composer; completion then reads the parts and writes the
 * object through `BlobStore.put`, as before.
 */
export interface StagedParts {
  composer(backendId: string): PartComposer | null;
}

export interface PartComposer {
  /**
   * Assembles the object of `id` from its accepted parts in the storage, not visible yet. A
   * repeat after a commit returns the committed object. `read_only` when the storage refuses.
   */
  compose(
    id: string,
    parts: readonly UploadPart[],
    cancellation: Cancellation,
  ): Promise<ComposedObject>;
}

export interface ComposedObject {
  /**
   * Reads every byte of the assembled object and checks its size and SHA-256 against
   * `expected`: the core measures, never the storage. `integrity_mismatch` otherwise.
   */
  verify(expected: ArtifactDescriptor, cancellation: Cancellation): Promise<void>;
  /** The storage's durability point: the object is published and immutable after it. */
  commit(expected: ArtifactDescriptor, cancellation: Cancellation): Promise<void>;
  /** Drops an object that was not committed; the parts stay. Idempotent. */
  discard(): Promise<void>;
}

export interface IdentitySource {
  next(): string;
  now(): string;
}

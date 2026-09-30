import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, UploadPart } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation } from '@proanima/arkvory-application';

export interface StorageTarget {
  readonly id: string;
  readonly store: BlobStore;
}

export interface LocalStorageLifecycle {
  ready(): Promise<void>;
  initialize(): Promise<void>;
  identity(readOnly?: boolean): Promise<string>;
  checkSpace(needed: number): Promise<void>;
  contentPath(id: string): string;
}

function hasLifecycle(store: unknown): store is LocalStorageLifecycle {
  return (
    typeof store === 'object' &&
    store !== null &&
    'ready' in store &&
    typeof (store as LocalStorageLifecycle).ready === 'function' &&
    'initialize' in store &&
    typeof (store as LocalStorageLifecycle).initialize === 'function'
  );
}

interface Collectable {
  collect(
    id: string,
    removeContent: boolean,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void>;
}

function isCollectable(store: unknown): store is Collectable {
  return (
    typeof store === 'object' &&
    store !== null &&
    'collect' in store &&
    typeof (store as Collectable).collect === 'function'
  );
}

export class RoutedBlobStore implements BlobStore {
  private readonly targets = new Map<string, BlobStore>();
  private readonly defaultTarget: BlobStore;

  constructor(defaultId: string, targets: readonly StorageTarget[]) {
    if (targets.length === 0)
      throw new ArkvoryError('invalid_input', 'At least one storage target is required');
    for (const target of targets) {
      if (this.targets.has(target.id))
        throw new ArkvoryError('conflict', `Duplicate storage target: ${target.id}`);
      this.targets.set(target.id, target.store);
    }
    const def = this.targets.get(defaultId);
    if (!def)
      throw new ArkvoryError('invalid_input', `Default storage target not found: ${defaultId}`);
    this.defaultTarget = def;
  }

  getTarget(backendId?: string): BlobStore {
    if (!backendId) return this.defaultTarget;
    return this.targets.get(backendId) ?? this.defaultTarget;
  }

  async putPart(
    id: string,
    part: UploadPart,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    return this.getTarget(backendId).putPart(id, part, source, cancellation, backendId);
  }

  readParts(
    id: string,
    parts: readonly UploadPart[],
    backendId?: string,
  ): AsyncIterable<Uint8Array> {
    return this.getTarget(backendId).readParts(id, parts, backendId);
  }

  async put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    return this.getTarget(backendId).put(id, expected, source, cancellation, backendId);
  }

  async verify(
    id: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    return this.getTarget(backendId).verify(id, expected, cancellation, backendId);
  }

  read(
    id: string,
    size: number,
    range?: { start: number; end: number },
    backendId?: string,
  ): AsyncIterable<Uint8Array> {
    return this.getTarget(backendId).read(id, size, range, backendId);
  }

  async exists(id: string, size: number, backendId?: string): Promise<void> {
    if (backendId) return this.getTarget(backendId).exists(id, size, backendId);
    try {
      await this.defaultTarget.exists(id, size);
      return;
    } catch {
      for (const [key, store] of this.targets) {
        if (store === this.defaultTarget) continue;
        try {
          await store.exists(id, size, key);
          return;
        } catch {
          // Probe next target
        }
      }
      throw new ArkvoryError(
        'unavailable',
        'Artifact content is unavailable in all storage targets',
      );
    }
  }

  async collect(
    id: string,
    removeContent: boolean,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    if (backendId) {
      const store = this.getTarget(backendId);
      if (isCollectable(store)) {
        await store.collect(id, removeContent, cancellation, backendId);
      }
      return;
    }
    for (const [key, store] of this.targets) {
      if (isCollectable(store)) {
        await store.collect(id, removeContent, cancellation, key);
      }
    }
  }

  contentPath(id: string, backendId?: string): string {
    const store = this.getTarget(backendId);
    if (hasLifecycle(store)) {
      return store.contentPath(id);
    }
    throw new ArkvoryError('unavailable', 'Storage target does not support local content paths');
  }

  async ready(): Promise<void> {
    for (const store of this.targets.values()) {
      if (hasLifecycle(store)) {
        await store.ready();
      }
    }
  }

  async initialize(): Promise<void> {
    for (const store of this.targets.values()) {
      if (hasLifecycle(store)) {
        await store.initialize();
      }
    }
  }

  async identity(readOnly = false): Promise<string> {
    if (hasLifecycle(this.defaultTarget)) {
      return await this.defaultTarget.identity(readOnly);
    }
    throw new ArkvoryError('unavailable', 'Default storage target does not support identity');
  }

  async checkSpace(needed: number): Promise<void> {
    if (hasLifecycle(this.defaultTarget)) {
      await this.defaultTarget.checkSpace(needed);
    }
  }
}

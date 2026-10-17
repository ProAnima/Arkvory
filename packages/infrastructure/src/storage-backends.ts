import { ArkvoryError, DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, BackendWriteState, UploadPart } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation, StorageBackendStates } from '@proanima/arkvory-application';
import type { StorageLifecycle } from './storage-lifecycle.js';

/** A storage that can also remove what cleanup admitted: every storage instance can. */
export type CollectingBlobStore = BlobStore & Required<Pick<BlobStore, 'collect'>>;

/**
 * One configured storage (ADR 0079, 5.1): its port, its explicit lifecycle and how it takes
 * writes. `read-only` serves reads, checks and export and refuses every write and removal;
 * `acceptsWrites: false` keeps it fully working for what it holds but gives it no new uploads.
 */
export interface StorageInstance {
  readonly id: string;
  readonly blobs: CollectingBlobStore;
  readonly lifecycle: StorageLifecycle;
  readonly mode: 'full' | 'read-only';
  readonly acceptsWrites: boolean;
  /** Switched off in the configuration: never opened, its uploads unreadable until enabled. */
  readonly enabled: boolean;
}

/** Why an enabled storage is not usable: a machine code for logs and metrics, never a path. */
export type StorageFault =
  'not_opened' | 'open_failed' | 'identity_unknown' | 'identity_mismatch' | 'probe_failed';

export interface StorageBackendStatus {
  readonly id: string;
  readonly state: BackendWriteState;
  readonly fault: StorageFault | null;
}

type Use = 'read' | 'write' | 'collect';

/**
 * The storages of one process behind the `BlobStore` port. Every call names its storage
 * (absent means `default`) and goes to exactly that one: reads always use the upload's
 * recorded storage and never probe or fall back to another one (ADR 0083, N11). The core's
 * storage `default` is opened by the process before anything else; any other storage may be
 * unavailable without stopping the process: its uploads answer `unavailable` and cleanup of
 * its files waits (`busy`) until it is back (ADR 0078, L5).
 *
 * Whether a storage takes new uploads is decided by placement and `StorageService`, not here:
 * an upload whose storage stopped taking data still finishes what it holds.
 */
export class StorageBackends implements BlobStore, StorageBackendStates {
  private readonly instances = new Map<string, StorageInstance>();
  private readonly faults = new Map<string, StorageFault>();
  readonly core: StorageInstance;

  constructor(instances: readonly StorageInstance[]) {
    for (const instance of instances) {
      if (this.instances.has(instance.id))
        throw new ArkvoryError('invalid_input', 'Duplicate storage backend');
      this.instances.set(instance.id, instance);
    }
    const core = this.instances.get(DEFAULT_STORAGE_BACKEND);
    if (!core || !core.enabled || core.mode !== 'full' || !core.acceptsWrites)
      throw new ArkvoryError('invalid_input', 'The default storage must be enabled and writable');
    this.core = core;
    // Nothing but the core's storage is usable before `open` proves it.
    for (const instance of this.extras())
      if (instance.enabled) this.faults.set(instance.id, 'not_opened');
  }

  /** The configured storages other than `default`, in configuration order. */
  extras(): readonly StorageInstance[] {
    return [...this.instances.values()].filter((instance) => instance !== this.core);
  }

  ids(): readonly string[] {
    return [...this.instances.keys()];
  }

  /** Marks an enabled storage usable (null) or not, after opening or probing it. */
  mark(id: string, fault: StorageFault | null): void {
    const instance = this.instances.get(id);
    if (!instance || instance === this.core || !instance.enabled) return;
    if (fault === null) this.faults.delete(id);
    else this.faults.set(id, fault);
  }

  fault(backendId: string): StorageFault | null {
    return this.faults.get(backendId) ?? null;
  }

  state(backendId: string): BackendWriteState {
    const instance = this.instances.get(backendId);
    if (!instance) return 'not_loaded';
    if (!instance.enabled) return 'disabled';
    if (this.faults.has(backendId)) return 'unavailable';
    if (instance.mode === 'read-only') return 'read_only';
    return instance.acceptsWrites ? 'accepting' : 'not_accepting';
  }

  status(): readonly StorageBackendStatus[] {
    return this.ids().map((id) => ({
      id,
      state: this.state(id),
      fault: this.faults.get(id) ?? null,
    }));
  }

  private target(backendId: string | undefined, use: Use): CollectingBlobStore {
    const id = backendId ?? DEFAULT_STORAGE_BACKEND;
    const state = this.state(id);
    if (state === 'not_loaded' || state === 'disabled' || state === 'unavailable') {
      // Cleanup waits for the storage instead of failing: the object is tried again later.
      if (use === 'collect') throw new ArkvoryError('busy', 'Storage backend is not available');
      throw new ArkvoryError('unavailable', 'Storage backend is not available');
    }
    if (state === 'read_only' && use !== 'read') {
      if (use === 'collect') throw new ArkvoryError('busy', 'Storage backend is read-only');
      throw new ArkvoryError('read_only', 'Storage backend is read-only');
    }
    const instance = this.instances.get(id);
    if (!instance) throw new ArkvoryError('unavailable', 'Storage backend is not available');
    return instance.blobs;
  }

  async putPart(
    id: string,
    part: UploadPart,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    await this.target(backendId, 'write').putPart(id, part, source, cancellation, backendId);
  }

  /** Lazy like every read: an unusable storage fails the first `next`, as a read error would. */
  async *readParts(
    id: string,
    parts: readonly UploadPart[],
    backendId?: string,
  ): AsyncIterable<Uint8Array> {
    yield* this.target(backendId, 'read').readParts(id, parts, backendId);
  }

  async put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    await this.target(backendId, 'write').put(id, expected, source, cancellation, backendId);
  }

  async verify(
    id: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    await this.target(backendId, 'read').verify(id, expected, cancellation, backendId);
  }

  /** A shared copy stays in the source's storage: hard links do not cross storages. */
  async duplicate(
    sourceId: string,
    targetId: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    const target = this.target(backendId, 'write');
    await target.duplicate(sourceId, targetId, expected, cancellation, backendId);
  }

  async *read(
    id: string,
    size: number,
    range?: { start: number; end: number },
    backendId?: string,
  ): AsyncIterable<Uint8Array> {
    yield* this.target(backendId, 'read').read(id, size, range, backendId);
  }

  async exists(id: string, size: number, backendId?: string): Promise<void> {
    await this.target(backendId, 'read').exists(id, size, backendId);
  }

  async collect(
    id: string,
    removeContent: boolean,
    cancellation: Cancellation,
    backendId?: string,
  ): Promise<void> {
    await this.target(backendId, 'collect').collect(id, removeContent, cancellation, backendId);
  }
}

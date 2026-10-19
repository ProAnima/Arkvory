import type { ModuleSignal } from './descriptor.js';
import type { BlobDescriptor, ByteRange, PartRef } from './portable.js';
import type { StagedCompletion } from './staged.js';

/** Portable bytes of one storage. Published blobs are immutable and verified on repeated put. */
export interface ModuleStorageBlobs {
  putPart(
    id: string,
    part: PartRef,
    source: AsyncIterable<Uint8Array>,
    signal: ModuleSignal,
  ): Promise<void>;
  readParts(id: string, parts: readonly PartRef[]): AsyncIterable<Uint8Array>;
  put(
    id: string,
    expected: BlobDescriptor,
    source: AsyncIterable<Uint8Array>,
    signal: ModuleSignal,
  ): Promise<void>;
  verify(id: string, expected: BlobDescriptor, signal: ModuleSignal): Promise<void>;
  read(id: string, size: number, range?: ByteRange): AsyncIterable<Uint8Array>;
  exists(id: string, size: number): Promise<void>;
  duplicate(
    sourceId: string,
    targetId: string,
    expected: BlobDescriptor,
    signal: ModuleSignal,
  ): Promise<void>;
  /** Called only under core cleanup locks, content pins and backup unlink admission. */
  collect(id: string, removeContent: boolean, signal: ModuleSignal): Promise<void>;
}

export interface ModuleStorageLifecycle {
  initialize(): Promise<void>;
  identity(readOnly?: boolean): Promise<string>;
  ready(): Promise<void>;
  checkSpace(bytes: number): Promise<void>;
  requireEmpty(): Promise<void>;
}

/** One instance owned by a signed storage module. The host prefixes its name with the module id. */
export interface ModuleStorageInstance {
  readonly blobs: ModuleStorageBlobs;
  readonly lifecycle: ModuleStorageLifecycle;
  readonly mode: 'full' | 'read-only';
  acceptsWrites(): boolean;
}

/** Registration during create only; available instances activate after successful start. */
export interface ModuleStorageRegistry {
  add(name: string, instance: ModuleStorageInstance): void;
}

/** Optional completion for a registered storage name, declared during create only. */
export interface StagedCompletionRegistry {
  add(name: string, completion: StagedCompletion): void;
}

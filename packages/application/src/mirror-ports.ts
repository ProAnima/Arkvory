import type { ArtifactDescriptor } from '@proanima/arkvory-domain';
import type { CatalogFeedEntry } from './catalog-ports.js';
import type { Cancellation } from './ports.js';

/*
 * Ports of a pull mirror (ADR 0058). The source is another Arkvory installation read over its
 * public API with a read-only key; the target is the local mirrored repository, changed only by
 * the synchronization. Both work with artifact IDs of the source.
 */
export interface MirrorArtifact {
  readonly id: string;
  readonly descriptor: ArtifactDescriptor;
}
export interface MirrorAnnotation {
  readonly labels: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly collections: readonly string[];
}
export interface MirrorStage {
  readonly stage: string;
  readonly comment: string | null;
}
export interface MirrorAsset {
  readonly path: string;
  readonly artifactId: string;
}
export interface MirrorPage<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
export interface MirrorFeedPage extends MirrorPage<CatalogFeedEntry> {
  readonly head: string;
}

export interface MirrorSource {
  changes(after: string, cancellation: Cancellation): Promise<MirrorFeedPage>;
  artifacts(after: string | null, cancellation: Cancellation): Promise<MirrorPage<MirrorArtifact>>;
  /** Artifact IDs of registered packages. */
  packages(after: string | null, cancellation: Cancellation): Promise<MirrorPage<string>>;
  assets(after: string | null, cancellation: Cancellation): Promise<MirrorPage<MirrorAsset>>;
  /** Null when the artifact is not available on the source any more. */
  artifact(id: string, cancellation: Cancellation): Promise<MirrorArtifact | null>;
  annotation(id: string, cancellation: Cancellation): Promise<MirrorAnnotation | null>;
  stages(id: string, cancellation: Cancellation): Promise<readonly MirrorStage[]>;
  asset(path: string, cancellation: Cancellation): Promise<MirrorAsset | null>;
  /** IDs of artifacts that currently carry `stage`, page by page (import mode). */
  staged(
    stage: string,
    after: string | null,
    cancellation: Cancellation,
  ): Promise<MirrorPage<string>>;
  /** Bytes start..end (inclusive) of the immutable artifact; the length is checked by the port. */
  content(
    artifact: MirrorArtifact,
    start: number,
    end: number,
    cancellation: Cancellation,
  ): Promise<AsyncIterable<Uint8Array>>;
}

export interface MirrorTarget {
  /**
   * Makes the artifact available locally under the source ID, resuming a partial copy part by
   * part. Returns the bytes copied now (0 when it was already available). Another SHA-256 for
   * the same ID is a MirrorFailure, never an overwrite.
   */
  copy(artifact: MirrorArtifact, source: MirrorSource, cancellation: Cancellation): Promise<number>;
  /** Deletes like a client deletion (tombstone, then GC); absence is success. */
  remove(id: string): Promise<void>;
  annotate(id: string, annotation: MirrorAnnotation): Promise<void>;
  register(id: string): Promise<void>;
  /**
   * Import mode: completes a taken-over version without overriding local decisions. The
   * annotation applies only while the local one was never changed, the bytes register as UPack
   * when they are one and are not registered yet, stages are only added. Repeatable after a crash.
   */
  adopt(
    id: string,
    annotation: MirrorAnnotation | null,
    stages: readonly MirrorStage[],
  ): Promise<void>;
  /** Local copy of a source ID: `deleted` means removed here, never to be imported again. */
  local(id: string): Promise<'absent' | 'partial' | 'present' | 'deleted'>;
  stages(id: string, stages: readonly MirrorStage[]): Promise<void>;
  asset(asset: MirrorAsset): Promise<void>;
  /** Registry rows of the copy (ADR 0063), over artifacts copied before; all repeatable. */
  ociBlob(digest: string, artifactId: string): Promise<void>;
  /**
   * The manifest held by the local artifact and, with a tag, the tag on it. Skipped when this
   * mirror lacks content it references: the source has deleted that since, and so will the feed.
   */
  ociManifest(image: string, artifactId: string, tag: string | null): Promise<void>;
  ociUntag(image: string, tag: string): Promise<void>;
  ociForget(image: string, digest: string): Promise<void>;
  /** The Git LFS object row of an oid (ADR 0065), over the copied artifact; repeatable. */
  lfsObject(oid: string, artifactId: string): Promise<void>;
}

export type MirrorPhase = 'seeding' | 'following';
export type MirrorSeedStep = 'artifacts' | 'packages' | 'assets';
/** Sequences and byte counts are decimal strings; times are ISO 8601 UTC. */
export interface MirrorState {
  readonly repository: string;
  /** `upstream|sourceRepository` the cursor belongs to. */
  readonly source: string;
  readonly phase: MirrorPhase;
  readonly seedStep: MirrorSeedStep | null;
  readonly seedAfter: string | null;
  readonly seedHead: string | null;
  readonly cursor: string;
  readonly head: string | null;
  readonly checkedAt: string | null;
  readonly syncedAt: string | null;
  readonly errorCode: string | null;
  readonly errorAt: string | null;
  readonly copiedArtifacts: number;
  readonly copiedBytes: string;
}
export interface MirrorStateStore {
  load(repository: string): Promise<MirrorState | null>;
  save(state: MirrorState): Promise<void>;
}

/** A synchronization stop with a machine code, recorded in the state and the status API. */
export class MirrorFailure extends Error {
  constructor(
    readonly code:
      | 'mirror_mismatch'
      | 'mirror_source_changed'
      | 'mirror_upload_cancelled'
      | 'mirror_delete_blocked',
    message: string,
  ) {
    super(message);
    this.name = 'MirrorFailure';
  }
}

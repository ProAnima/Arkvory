import {
  ArkvoryError,
  MAX_MOVES_PLANNED,
  afterStep,
  isActiveMove,
  requireMove,
  requireRepository,
  stepOf,
} from '@proanima/arkvory-domain';
import type { ActiveMoveState, ArtifactDescriptor, BlobMoveState } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation } from './ports.js';
import type { ContentPinning } from './catalog-read.js';
import type { StorageBackendStates } from './storage-placement.js';

/** A move this process holds the lease of; `generation` fences every write of its progress. */
export interface ClaimedMove {
  readonly id: string;
  readonly uploadId: string;
  readonly from: string;
  readonly to: string;
  readonly state: ActiveMoveState;
  readonly generation: number;
}

export interface MovePlan {
  readonly from: string;
  readonly to: string;
  /** Only uploads of this repository; null for all. */
  readonly repository: string | null;
  readonly limit: number;
}

/** Durable state of moves (`arkvory_blob_moves`); writes are fenced by generation. */
export interface BlobMoveStore {
  /** Plans a move for every published upload of `from` without an active move, at most `limit`. */
  plan(plan: MovePlan): Promise<number>;
  counts(): Promise<Readonly<Partial<Record<BlobMoveState, number>>>>;
  /** Takes the lease of up to `limit` active moves whose lease is free or expired. */
  claim(limit: number): Promise<readonly ClaimedMove[]>;
  /** Records a step done; false when the lease was lost (the move is someone else's). */
  advance(move: ClaimedMove, state: BlobMoveState): Promise<boolean>;
  /** Gives the lease back without counting an attempt: a lock or a storage was busy. */
  defer(move: ClaimedMove): Promise<boolean>;
  /** Counts a failed attempt; the last one, or a `final` failure, ends the move as `failed`. */
  fail(move: ClaimedMove, code: string, final: boolean): Promise<boolean>;
  /** Extends the lease during a long copy; false when it was lost. */
  heartbeat(move: ClaimedMove): Promise<boolean>;
}

export interface MovedUpload {
  readonly descriptor: ArtifactDescriptor;
  readonly status: 'pending' | 'available' | 'cancelled';
  readonly storageBackend: string;
}

/** The upload side of a move: its row, and the switch of its storage. */
export interface UploadStorageSwitch {
  read(uploadId: string): Promise<MovedUpload | null>;
  /**
   * In one short transaction under the upload's lock, no I/O: the upload's storage becomes `to`
   * when it is still published in `from`. `switched` also when it already is in `to`; `gone`
   * when it is neither; `busy` when the upload is locked now.
   */
  switchStorage(uploadId: string, from: string, to: string): Promise<'switched' | 'gone' | 'busy'>;
}

/**
 * Removal of one copy in the core's deletion order (ADR 0035, ADR 0054): upload lock → content
 * lock (try exclusive) → unlink admission (barrier open, no backup pin) → collect → unlock.
 * False when any of them is busy: the removal is deferred, never waited for.
 */
export interface CopyRemoval {
  remove(uploadId: string, backend: string, cancellation: Cancellation): Promise<boolean>;
}

/**
 * Plans moves of published uploads from one storage to another (`arkvory storage rehome`): both
 * storages configured, the target taking data, at most `MAX_MOVES_PLANNED` at once.
 */
export async function planRehome(
  moves: Pick<BlobMoveStore, 'plan'>,
  states: StorageBackendStates,
  plan: MovePlan,
): Promise<number> {
  requireMove(plan.from, plan.to, (id) => states.state(id));
  if (plan.repository !== null) requireRepository(plan.repository);
  if (!Number.isSafeInteger(plan.limit) || plan.limit < 1 || plan.limit > MAX_MOVES_PLANNED)
    throw new ArkvoryError('invalid_input', 'Invalid move limit');
  const planned = await moves.plan(plan);
  return planned;
}

export type MoveOutcome =
  | { readonly kind: 'advanced'; readonly state: BlobMoveState }
  | { readonly kind: 'deferred' | 'failed' | 'lost' };

/** How a run of a claimed move ended, and the state it holds then. */
export interface MoveRun {
  readonly outcome: 'done' | 'deferred' | 'failed' | 'lost';
  readonly state: BlobMoveState;
}

/**
 * Moving published blobs between storages (ADR 0083, N2): the id stays, the bytes are copied
 * and verified in the target, the upload switches storage, the source copy is released by the
 * core's ordinary removal. Readers resolve the storage from the upload row at every request; a
 * download begun before the switch holds the shared content lock and finishes from the source,
 * a backup pin keeps the source until the copy point is done. Every step repeats on its own
 * after a crash or a lost lease; nothing waits for a lock.
 */
export class RehomeBlobs {
  constructor(
    private readonly moves: BlobMoveStore,
    private readonly uploads: UploadStorageSwitch,
    private readonly removal: CopyRemoval,
    private readonly blobs: Pick<BlobStore, 'put' | 'read'>,
    private readonly states: StorageBackendStates,
    private readonly pins: ContentPinning,
    /** Paces the copy: the rehome bandwidth budget (ARKVORY_REHOME_BYTES_PER_SECOND). */
    private readonly pace: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array> = (
      source,
    ) => source,
  ) {}

  /**
   * Steps a claimed move until it is final, deferred, failed or its lease is lost; `progress`
   * learns each active state the move holds next (its lease is renewed with that state).
   */
  async run(
    move: ClaimedMove,
    cancellation: Cancellation,
    progress: (move: ClaimedMove) => void = () => undefined,
  ): Promise<MoveRun> {
    let current = move;
    for (;;) {
      const result = await this.step(current, cancellation);
      if (result.kind !== 'advanced') return { outcome: result.kind, state: current.state };
      if (!isActiveMove(result.state)) return { outcome: 'done', state: result.state };
      current = { ...current, state: result.state };
      progress(current);
    }
  }

  /** One step of a claimed move. */
  async step(move: ClaimedMove, cancellation: Cancellation): Promise<MoveOutcome> {
    try {
      switch (stepOf(move.state)) {
        case 'copy':
          return await this.copy(move, cancellation);
        case 'switch':
          return await this.switch(move, cancellation);
        case 'release':
          return await this.settle(move, move.from, afterStep(move.state), cancellation);
      }
    } catch (error) {
      // A lost lease or a stopping worker is not the move's failure: another attempt follows.
      cancellation.throwIfAborted();
      const code = error instanceof ArkvoryError ? error.code : 'unavailable';
      return this.failure(move, code, false);
    }
  }

  private async failure(move: ClaimedMove, code: string, final: boolean): Promise<MoveOutcome> {
    return { kind: (await this.moves.fail(move, code, final)) ? 'failed' : 'lost' };
  }

  private async copy(move: ClaimedMove, cancellation: Cancellation): Promise<MoveOutcome> {
    const upload = await this.uploads.read(move.uploadId);
    // A crash after the switch and before its record: the switch is done.
    if (upload?.storageBackend === move.to) return this.advance(move, 'copied');
    if (upload?.status !== 'available' || upload.storageBackend !== move.from)
      return this.settle(move, move.to, 'skipped', cancellation);
    const target = this.states.state(move.to);
    if (target === 'unavailable') return this.defer(move);
    if (target !== 'accepting') return this.failure(move, 'backend_read_only', true);
    let pin;
    try {
      pin = await this.pins.acquire(move.uploadId);
    } catch (error) {
      // Being reclaimed: the next attempt finds the upload cancelled and skips it.
      if (error instanceof ArkvoryError && error.code === 'busy') return this.defer(move);
      throw error;
    }
    try {
      const { size } = upload.descriptor;
      const source = this.blobs.read(move.uploadId, size, undefined, move.from);
      const check = {
        throwIfAborted() {
          cancellation.throwIfAborted();
          pin.check();
        },
      };
      // The target checks size and SHA-256 and makes the copy durable; an existing copy of an
      // earlier attempt is verified by hash, so the step repeats safely.
      await this.blobs.put(move.uploadId, upload.descriptor, this.pace(source), check, move.to);
    } finally {
      await pin.release();
    }
    return this.advance(move, 'copied');
  }

  private async switch(move: ClaimedMove, cancellation: Cancellation): Promise<MoveOutcome> {
    const result = await this.uploads.switchStorage(move.uploadId, move.from, move.to);
    if (result === 'busy') return this.defer(move);
    // Cancelled or deleted meanwhile: the copy in the target has no owner and is removed.
    if (result === 'gone') return this.settle(move, move.to, 'skipped', cancellation);
    return this.advance(move, 'switched');
  }

  /** Removes the copy in `backend` and records `state`, or defers while anything is busy. */
  private async settle(
    move: ClaimedMove,
    backend: string,
    state: BlobMoveState,
    cancellation: Cancellation,
  ): Promise<MoveOutcome> {
    if (!(await this.removal.remove(move.uploadId, backend, cancellation))) return this.defer(move);
    return this.advance(move, state);
  }

  private async advance(move: ClaimedMove, state: BlobMoveState): Promise<MoveOutcome> {
    return (await this.moves.advance(move, state)) ? { kind: 'advanced', state } : { kind: 'lost' };
  }

  private async defer(move: ClaimedMove): Promise<MoveOutcome> {
    return { kind: (await this.moves.defer(move)) ? 'deferred' : 'lost' };
  }
}

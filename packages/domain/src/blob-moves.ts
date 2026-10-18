import { ArkvoryError } from './artifact.js';
import { STORAGE_BACKEND_ID } from './storage-placement.js';
import type { BackendWriteState } from './storage-placement.js';

/**
 * States of moving one published blob to another storage (ADR 0083, N2). Each active state
 * names the step still to do; `released`, `skipped` (the upload was no longer published; the
 * copy in the target was removed) and `failed` (after `MAX_MOVE_ATTEMPTS` failed attempts, or a
 * target that takes no data) are final.
 */
export const BLOB_MOVE_STATES = [
  'planned',
  'copied',
  'switched',
  'released',
  'skipped',
  'failed',
] as const;
export type BlobMoveState = (typeof BLOB_MOVE_STATES)[number];
export type ActiveMoveState = Extract<BlobMoveState, 'planned' | 'copied' | 'switched'>;
export const ACTIVE_MOVE_STATES: readonly ActiveMoveState[] = ['planned', 'copied', 'switched'];

/**
 * A failed step is repeated; the fifth failure ends the move as `failed`, except in `switched`:
 * the upload already lives in the target there, and only the source copy is left to release,
 * which nothing else would ever remove, so its attempts keep backing off instead.
 */
export const MAX_MOVE_ATTEMPTS = 5;
/** A step deferred by a busy lock (a download, a backup pin) is tried again this soon. */
export const MOVE_RETRY_SECONDS = 5;
/** A step waiting for a storage that is unavailable or read-only now is tried again this late. */
export const MOVE_WAIT_SECONDS = 300;
/** Moves planned by one command at most. */
export const MAX_MOVES_PLANNED = 100_000;

/**
 * The step of an active move: copy the bytes to the target, switch the upload's storage, release
 * the source copy. Each step is repeatable on its own after a crash.
 */
export type MoveStep = 'copy' | 'switch' | 'release';

export function stepOf(state: ActiveMoveState): MoveStep {
  switch (state) {
    case 'planned':
      return 'copy';
    case 'copied':
      return 'switch';
    case 'switched':
      return 'release';
  }
}

/** The state a successful step leads to. */
export function afterStep(state: ActiveMoveState): Exclude<BlobMoveState, 'planned'> {
  switch (state) {
    case 'planned':
      return 'copied';
    case 'copied':
      return 'switched';
    case 'switched':
      return 'released';
  }
}

export function isActiveMove(state: BlobMoveState): state is ActiveMoveState {
  return ACTIVE_MOVE_STATES.some((active) => active === state);
}

/** Why a move cannot start: the storages it names, as the process sees them. */
export function requireMove(
  from: string,
  to: string,
  state: (backendId: string) => BackendWriteState,
): void {
  if (!STORAGE_BACKEND_ID.test(from) || !STORAGE_BACKEND_ID.test(to) || from === to)
    throw new ArkvoryError('invalid_input', 'Invalid storage of a move');
  for (const id of [from, to])
    if (state(id) === 'not_loaded')
      throw new ArkvoryError('invalid_input', 'Unknown storage', { reason: 'backend_unknown' });
  // A target that is not open in this process yet is checked again by the worker; one that
  // takes no data is refused at once. A read-only source is the point of an evacuation.
  const target = state(to);
  if (target !== 'accepting' && target !== 'unavailable')
    throw new ArkvoryError('conflict', 'The target storage takes no new data', {
      reason: 'backend_read_only',
    });
}

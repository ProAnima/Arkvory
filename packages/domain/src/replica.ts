/** A DRBD peer of the active node as the console shows it (ADR 0072). */
export interface ReplicaPeer {
  readonly name: string;
  readonly connected: boolean;
  /** DRBD's disk state of the peer, e.g. UpToDate, Inconsistent, Diskless, DUnknown. */
  readonly disk: string;
  /** Connected, replicating and up to date: a copy that holds every acknowledged write. */
  readonly complete: boolean;
  /** The diskless tiebreaker of ha-2: it votes, it holds no copy. */
  readonly witness: boolean;
}
/**
 * Copies of an HA cluster's volume (ADR 0072): how many are complete now and how many a write
 * needs before the server may acknowledge it. `singleCopyUntil` is an operator's time-limited
 * decision to accept one copy; it is already reflected in `required`.
 */
export interface ReplicaCopies {
  readonly copies: number;
  readonly required: number;
  readonly singleCopyUntil: string | null;
  /** The node that serves now; absent from helpers of earlier releases. */
  readonly node?: string;
  readonly profile?: 'ha-2' | 'ha-3';
  readonly peers?: readonly ReplicaPeer[];
}

/**
 * Whether a write that has just completed may be acknowledged. A replica that missed any write
 * is not complete until resynchronized, so `copies` read after the write completed counts only
 * copies that hold it.
 */
export function acknowledges(state: ReplicaCopies): boolean {
  return state.copies >= state.required;
}

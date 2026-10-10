/**
 * Copies of an HA cluster's volume (ADR 0072): how many are complete now and how many a write
 * needs before the server may acknowledge it. `singleCopyUntil` is an operator's time-limited
 * decision to accept one copy; it is already reflected in `required`.
 */
export interface ReplicaCopies {
  readonly copies: number;
  readonly required: number;
  readonly singleCopyUntil: string | null;
}

/**
 * Whether a write that has just completed may be acknowledged. A replica that missed any write
 * is not complete until resynchronized, so `copies` read after the write completed counts only
 * copies that hold it.
 */
export function acknowledges(state: ReplicaCopies): boolean {
  return state.copies >= state.required;
}

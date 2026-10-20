/** One opaque, durable coordination document per module (ADR 0086). */
export interface ModuleStateSnapshot {
  /** Positive decimal uint63; compare as a string, never convert to Number. */
  readonly revision: string;
  readonly value: Uint8Array;
}

export type ModuleStateWrite =
  { readonly kind: 'stored'; readonly revision: string } | { readonly kind: 'conflict' };

export const MAX_MODULE_STATE_BYTES = 8 * 1024 * 1024;

/**
 * Namespace is bound by the host, never selected by a module. API/worker may replace the
 * document; reader/backup only read it. Data is bounded, not a blob store. It lives in the
 * installation database and survives HA failover; portable logical backups do not carry it.
 * Consumers must handle a missing document after restore explicitly, never infer that a
 * previous external operation did not happen. Removal/reinstall of a module does not reset it.
 */
export interface ModuleState {
  read(): Promise<ModuleStateSnapshot | null>;
  /**
   * Null requires absence; otherwise exactly the observed revision must match. Revisions
   * advance even if the bytes are unchanged. The durable database commit precedes `stored`.
   * On an uncertain result reread: this is CAS, not exactly-once execution. Consumers retry
   * conflicts with a finite budget and recompute from the new state. No deletion or reset API.
   */
  compareExchange(expected: string | null, value: Uint8Array): Promise<ModuleStateWrite>;
}

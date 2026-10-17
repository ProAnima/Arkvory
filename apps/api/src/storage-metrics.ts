import type { PlacementDecision } from '@proanima/arkvory-domain';
import { storageChangeRecord } from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticRecord,
  MetricsRegistry,
  StorageBackends,
  StorageFault,
} from '@proanima/arkvory-infrastructure';

/** One warning per storage and reason in this window, however many uploads fall back. */
const FALLBACK_LOG_MS = 60_000;

type Log = (record: DiagnosticRecord) => void;

/**
 * Gauges of the storages of this process and the count of new uploads sent to the core's
 * storage instead of the one their placement chose (ADR 0083, N11). Labels are bounded: the
 * storage ids of the configuration and of saved rules, and the closed set of fallback reasons.
 */
export class StorageMetrics {
  private readonly fallbacks = new Map<
    string,
    { backend: string; reason: string; count: number }
  >();
  private readonly logged = new Map<string, number>();
  private log: Log | undefined;

  constructor(
    private readonly backends: Pick<StorageBackends, 'status' | 'unconfigured'>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Starts logging fallbacks and storage changes to the process log. */
  bind(log: Log): void {
    this.log = log;
    for (const { id, fault } of this.backends.status()) if (fault !== null) this.changed(id, fault);
    for (const id of this.backends.unconfigured()) this.changed(id, 'not_configured');
  }

  fellBack(decision: PlacementDecision): void {
    if (decision.fallback === null) return;
    const key = `${decision.requested}\0${decision.fallback}`;
    const entry = this.fallbacks.get(key) ?? {
      backend: decision.requested,
      reason: decision.fallback,
      count: 0,
    };
    entry.count++;
    this.fallbacks.set(key, entry);
    const last = this.logged.get(key);
    if (last !== undefined && this.now() - last < FALLBACK_LOG_MS) return;
    this.logged.set(key, this.now());
    this.log?.({
      level: 'warning',
      component: 'storage',
      code: 'storage.placement_fallback',
      backend: decision.requested,
      reason: decision.fallback,
    });
  }

  /** A storage became unavailable (`fault`), available again (null) or unconfigured. */
  changed(id: string, fault: StorageFault | null): void {
    this.log?.(storageChangeRecord(id, fault));
  }

  register(registry: MetricsRegistry): void {
    registry.sampled({
      name: 'arkvory_storage_backend_up',
      help: 'Whether a storage of this process is open and answering (1) or not (0).',
      type: 'gauge',
      labels: ['backend'],
      collect: () =>
        this.backends.status().map(({ id, state }) => ({
          labels: { backend: id },
          value:
            state === 'accepting' || state === 'read_only' || state === 'not_accepting' ? 1 : 0,
        })),
    });
    registry.sampled({
      name: 'arkvory_storage_backend_accepting',
      help: 'Whether a storage takes new uploads (1) or new uploads go to the default storage (0).',
      type: 'gauge',
      labels: ['backend'],
      collect: () =>
        this.backends.status().map(({ id, state }) => ({
          labels: { backend: id },
          value: state === 'accepting' ? 1 : 0,
        })),
    });
    registry.sampled({
      name: 'arkvory_storage_backend_unconfigured',
      help: 'A storage that holds data of the installation but is not configured here (always 1).',
      type: 'gauge',
      labels: ['backend'],
      collect: () =>
        this.backends.unconfigured().map((id) => ({ labels: { backend: id }, value: 1 })),
    });
    registry.sampled({
      name: 'arkvory_storage_placement_fallback_total',
      help: 'New uploads created in the default storage because the chosen storage took no data.',
      type: 'counter',
      labels: ['backend', 'reason'],
      collect: () =>
        [...this.fallbacks.values()].map(({ backend, reason, count }) => ({
          labels: { backend, reason },
          value: count,
        })),
    });
  }
}

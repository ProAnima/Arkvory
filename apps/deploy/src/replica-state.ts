/**
 * The kernel's view of an HA cluster volume (ADR 0072), from `drbdsetup status --json`.
 *
 * A **complete copy** is this node's disk when every volume is `UpToDate`, and each peer whose
 * connection is `Connected` and every volume of which replicates (`Established`) onto an
 * `UpToDate` disk. Protocol C completes a write only after every connected complete peer wrote
 * it, and a peer that missed a write is no longer `UpToDate` until resynchronized: copies read
 * after a write completed are copies that hold it. A diskless tiebreaker never counts.
 */
export interface VolumeState {
  readonly role: string;
  readonly copies: number;
}

type Entry = Record<string, unknown>;
const entries = (value: unknown, what: string): Entry[] => {
  if (!Array.isArray(value)) throw new Error(`drbdsetup status: ${what} is not a list`);
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new Error(`drbdsetup status: ${what} entry is not an object`);
    return item as Entry;
  });
};

export function volumeState(status: unknown, resource: string): VolumeState {
  const found = entries(status, 'resources').find((entry) => entry['name'] === resource);
  if (!found) throw new Error(`drbdsetup status: resource ${resource} is not configured`);
  const devices = entries(found['devices'], 'devices');
  if (devices.length === 0) throw new Error(`drbdsetup status: ${resource} has no volumes`);
  const local = devices.every((device) => device['disk-state'] === 'UpToDate') ? 1 : 0;
  const peers = entries(found['connections'] ?? [], 'connections').filter((connection) => {
    if (connection['connection-state'] !== 'Connected') return false;
    const volumes = entries(connection['peer_devices'] ?? [], 'peer devices');
    return (
      volumes.length === devices.length &&
      volumes.every(
        (volume) =>
          volume['replication-state'] === 'Established' &&
          volume['peer-disk-state'] === 'UpToDate' &&
          volume['peer-client'] !== true,
      )
    );
  }).length;
  const role = typeof found['role'] === 'string' ? found['role'] : 'Unknown';
  return { role, copies: local + peers };
}

/** An operator's time-limited decision to acknowledge writes with one copy. */
export interface SingleCopyDecision {
  readonly until: string;
  readonly reason: string;
  readonly decidedAt: string;
}

/** Longest a single-copy decision may last: a forgotten one must not become the normal state. */
export const MAX_SINGLE_COPY_MS = 7 * 24 * 3600 * 1000;

export function parseDecision(value: unknown): SingleCopyDecision {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid single-copy decision');
  const { until, reason, decidedAt } = value as Entry;
  if (
    typeof until !== 'string' ||
    Number.isNaN(Date.parse(until)) ||
    typeof decidedAt !== 'string' ||
    Number.isNaN(Date.parse(decidedAt)) ||
    typeof reason !== 'string' ||
    reason.trim().length < 3 ||
    reason.length > 500
  )
    throw new Error('Invalid single-copy decision');
  return { until, reason, decidedAt };
}

/** What the replica helper answers: copies, and the copies a write needs now. */
export function replicaAnswer(
  copies: number,
  required: number,
  decision: SingleCopyDecision | null,
  now: number,
) {
  const active = decision !== null && Date.parse(decision.until) > now;
  return {
    copies,
    required: active ? 1 : required,
    singleCopyUntil: active ? decision.until : null,
  };
}

/**
 * Runs reads so that every caller gets a read that **started after its call**: callers waiting
 * for the same next read share it, and nobody gets a read already under way when they asked.
 */
export class FreshReads<T> {
  private running: Promise<unknown> = Promise.resolve();
  private next: Promise<T> | undefined;

  constructor(private readonly read: () => Promise<T>) {}

  get(): Promise<T> {
    this.next ??= this.running.then(() => {
      this.next = undefined;
      const reading = this.read();
      this.running = reading.catch(() => undefined);
      return reading;
    });
    return this.next;
  }
}

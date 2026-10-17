import type { StorageBackends, StorageFault, StorageInstance } from './storage-backends.js';

/** The identity each storage had when first opened, kept in the database of the installation. */
export interface StorageIdentityRecords {
  recorded(backendId: string): Promise<string | null>;
  /** Records the identity unless one exists; returns the identity on record afterwards. */
  record(backendId: string, storageId: string): Promise<string>;
}

type Probed =
  | { readonly fault: StorageFault; readonly identity?: undefined }
  | {
      readonly fault: null;
      readonly identity: string;
    };

/**
 * Opens one storage, or checks an open one again. The identity file of the storage must be the
 * one on record: a volume that is not mounted, or another installation's volume at the same
 * path, is never written to. Only a process that may create (`create`, the writer API) records
 * the identity of a storage seen for the first time; the others wait for it. Once an identity
 * is on record no process creates one again, and an identity that another storage of this
 * process already has (two ids for one directory) is refused before it is recorded. Failures of
 * the database are thrown: they say nothing about the storage, so its state is kept.
 */
async function probe(
  instance: StorageInstance,
  records: StorageIdentityRecords,
  create: boolean,
  taken: ReadonlySet<string>,
): Promise<Probed> {
  const recorded = await records.recorded(instance.id);
  const { lifecycle } = instance;
  const readOnly = instance.mode === 'read-only' || !create || recorded !== null;
  let identity: string;
  try {
    if (recorded === null && !create) return { fault: 'identity_unknown' };
    if (recorded === null && !readOnly) await lifecycle.initialize();
    else await lifecycle.ready();
    identity = await lifecycle.identity(readOnly);
  } catch {
    return { fault: recorded === null ? 'open_failed' : 'probe_failed' };
  }
  if (taken.has(identity)) return { fault: 'identity_mismatch' };
  const expected = recorded ?? (await records.record(instance.id, identity));
  return identity === expected ? { fault: null, identity } : { fault: 'identity_mismatch' };
}

export interface ProbeOptions {
  readonly create: boolean;
  /** Told when a storage changes between usable and not, with the new fault (null: usable). */
  readonly changed?: (id: string, fault: StorageFault | null) => void;
}

/**
 * Opens or rechecks every enabled storage other than `default`, one after another. A storage
 * that fails is marked unavailable and the process keeps running; a database failure leaves
 * every state as it was.
 */
export async function probeStorageBackends(
  backends: StorageBackends,
  records: StorageIdentityRecords,
  options: ProbeOptions,
): Promise<void> {
  const taken = new Set<string>();
  const core = await backends.core.lifecycle.identity(true).catch(() => null);
  if (core !== null) taken.add(core);
  for (const instance of backends.extras()) {
    if (!instance.enabled) continue;
    const before = backends.fault(instance.id);
    let probed: Probed;
    try {
      probed = await probe(instance, records, options.create, taken);
    } catch {
      continue;
    }
    if (probed.fault === null) {
      taken.add(probed.identity);
      backends.mark(instance.id, null, probed.identity);
    } else backends.mark(instance.id, probed.fault);
    if (before !== probed.fault) options.changed?.(instance.id, probed.fault);
  }
}

/** How often a running process rechecks its storages. */
export const STORAGE_PROBE_MS = 30_000;

/**
 * Rechecks the storages every `intervalMs` until stopped; one check at a time. The timer does
 * not keep the process alive.
 */
export function watchStorageBackends(
  backends: StorageBackends,
  records: StorageIdentityRecords,
  options: ProbeOptions & { readonly intervalMs?: number },
): () => void {
  if (backends.extras().length === 0) return () => undefined;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    probeStorageBackends(backends, records, options)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, options.intervalMs ?? STORAGE_PROBE_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

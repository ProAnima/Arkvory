import type { StorageBackends, StorageFault, StorageInstance } from './storage-backends.js';

/** The identity each storage had when first opened, kept in the database of the installation. */
export interface StorageIdentityRecords {
  recorded(backendId: string): Promise<string | null>;
  /** Records the identity unless one exists; returns the identity on record afterwards. */
  record(backendId: string, storageId: string): Promise<string>;
}

/**
 * Opens one storage, or checks an open one again. The identity file of the storage must be the
 * one on record: a volume that is not mounted, or another installation's volume at the same
 * path, is never written to. Only a process that may create (`create`, the writer API) records
 * the identity of a storage seen for the first time; the others wait for it. Failures of the
 * database are thrown: they say nothing about the storage, so its state is kept.
 */
async function probe(
  instance: StorageInstance,
  records: StorageIdentityRecords,
  create: boolean,
): Promise<StorageFault | null> {
  const recorded = await records.recorded(instance.id);
  const { lifecycle } = instance;
  const readOnly = instance.mode === 'read-only' || !create;
  let identity: string;
  try {
    if (recorded === null && !create) return 'identity_unknown';
    if (recorded === null && !readOnly) await lifecycle.initialize();
    else await lifecycle.ready();
    identity = await lifecycle.identity(readOnly);
  } catch {
    return recorded === null ? 'open_failed' : 'probe_failed';
  }
  const expected = recorded ?? (await records.record(instance.id, identity));
  return identity === expected ? null : 'identity_mismatch';
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
  for (const instance of backends.extras()) {
    if (!instance.enabled) continue;
    const before = backends.fault(instance.id);
    let fault: StorageFault | null;
    try {
      fault = await probe(instance, records, options.create);
    } catch {
      continue;
    }
    backends.mark(instance.id, fault);
    if (before !== fault) options.changed?.(instance.id, fault);
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

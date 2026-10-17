import type { DiagnosticRecord } from './diagnostics.js';
import type { StorageBackends, StorageFault, StorageInstance } from './storage-backends.js';

/**
 * The log line of a storage that became usable (null), unusable, or was found unconfigured
 * while it holds data (`storage.backend_unconfigured`); the same in every process.
 */
export function storageChangeRecord(id: string, fault: StorageFault | null): DiagnosticRecord {
  if (fault === null)
    return { level: 'info', component: 'storage', code: 'storage.backend_available', backend: id };
  if (fault === 'not_configured')
    return {
      level: 'warning',
      component: 'storage',
      code: 'storage.backend_unconfigured',
      backend: id,
    };
  return {
    level: 'warning',
    component: 'storage',
    code: 'storage.backend_unavailable',
    backend: id,
    reason: fault,
  };
}

/** The identity each storage had when first opened, kept in the database of the installation. */
export interface StorageIdentityRecords {
  recorded(backendId: string): Promise<string | null>;
  /** Records the identity unless one exists; returns the identity on record afterwards. */
  record(backendId: string, storageId: string): Promise<string>;
  /** Every storage ever recorded: those that held data of this installation, at most 64. */
  known(): Promise<readonly string[]>;
}

type Probed =
  | { readonly fault: StorageFault; readonly identity?: undefined }
  | {
      readonly fault: null;
      readonly identity: string;
    };

/**
 * Opens one storage, or checks an open one again. No process ever creates the identity file of
 * a volume: `arkvory volume-init` writes it on the host, after checking that the directory is
 * an empty volume of its own. A volume without the file is `not_initialized`, so the empty mount
 * point of a volume that is not mounted is never laid out or written to (ADR 0083, N11). The
 * identity must be the one on record; only a process that may create (`create`, the writer API)
 * records the identity of a volume seen for the first time and creates its layout inside the
 * marked directory; the others wait for it. An identity that another storage of this process
 * already has (two ids for one directory) is refused before it is recorded. Failures of the
 * database are thrown: they say nothing about the storage, so its state is kept.
 */
async function probe(
  instance: StorageInstance,
  records: StorageIdentityRecords,
  create: boolean,
  taken: ReadonlySet<string>,
): Promise<Probed> {
  const recorded = await records.recorded(instance.id);
  const { lifecycle } = instance;
  if (recorded === null && !create) return { fault: 'identity_unknown' };
  let identity: string;
  try {
    identity = await lifecycle.identity(true);
  } catch {
    return { fault: recorded === null ? 'not_initialized' : 'probe_failed' };
  }
  if (taken.has(identity)) return { fault: 'identity_mismatch' };
  if (recorded !== null && identity !== recorded) return { fault: 'identity_mismatch' };
  try {
    if (recorded === null && instance.mode === 'full') await lifecycle.initialize();
    else await lifecycle.ready();
  } catch {
    return { fault: recorded === null ? 'open_failed' : 'probe_failed' };
  }
  const expected = recorded ?? (await records.record(instance.id, identity));
  return identity === expected ? { fault: null, identity } : { fault: 'identity_mismatch' };
}

export interface ProbeOptions {
  readonly create: boolean;
  /**
   * Told when a storage changes between usable and not, with the new fault (null: usable), and
   * once when a storage that holds data of the installation is no longer configured
   * (`not_configured`).
   */
  readonly changed?: (id: string, fault: StorageFault | null) => void;
}

/**
 * Storages on record that this process does not configure: removed from the modules file while
 * uploads may still name them. Their files cannot be read, cleaned or backed up until the
 * instance is configured again, so they are reported instead of being deferred silently.
 */
async function findUnconfigured(
  backends: StorageBackends,
  records: StorageIdentityRecords,
  options: ProbeOptions,
): Promise<void> {
  const configured = new Set(backends.ids());
  const missing = (await records.known()).filter((id) => !configured.has(id));
  const before = new Set(backends.unconfigured());
  backends.markUnconfigured(missing);
  for (const id of missing) if (!before.has(id)) options.changed?.(id, 'not_configured');
}

/**
 * Opens or rechecks every enabled storage other than `default`, one after another, and finds
 * storages that hold data but are not configured. A storage that fails is marked unavailable
 * and the process keeps running; a database failure leaves every state as it was.
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
  await findUnconfigured(backends, records, options).catch(() => undefined);
}

/** How often a running process rechecks its storages. */
export const STORAGE_PROBE_MS = 30_000;

/**
 * Rechecks the storages every `intervalMs` until stopped; one check at a time. It runs without
 * configured volumes too: a volume removed from the configuration is found that way. The timer
 * does not keep the process alive.
 */
export function watchStorageBackends(
  backends: StorageBackends,
  records: StorageIdentityRecords,
  options: ProbeOptions & { readonly intervalMs?: number },
): () => void {
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

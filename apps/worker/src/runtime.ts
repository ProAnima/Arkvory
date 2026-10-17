import { setTimeout as delay } from 'node:timers/promises';
import { PolicyPlacement } from '@proanima/arkvory-application';
import {
  dataVolumeStaging,
  localStorageBackends,
  PostgresCatalog,
  PostgresPlacementPolicies,
  PostgresStorageIdentities,
  probeStorageBackends,
  readLocalStorageSettings,
  WorkerSingletonBusy,
  storageReserveBytes,
} from '@proanima/arkvory-infrastructure';
/** Capacity matters only for uploads the worker creates itself (mirror copies, ADR 0058). */
export function capacityBytes(value: string | undefined): number {
  if (value === undefined || value === '') return 10 * 1024 ** 4;
  if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid ARKVORY_CAPACITY_BYTES');
  return Number(value);
}

export async function resources(role: 'worker' | 'maintenance', capacity = 0, writers = 2) {
  const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
  const root = process.env['ARKVORY_DATA_DIR'];
  if (!databaseUrl || !root)
    throw new Error('ARKVORY_DATABASE_URL and ARKVORY_DATA_DIR are required');
  // Every storage of the installation: `local-storage` in ARKVORY_MODULES_FILE (ADR 0083, N11).
  const blobs = localStorageBackends(
    root,
    storageReserveBytes(process.env['ARKVORY_STORAGE_RESERVE_BYTES']),
    await readLocalStorageSettings(process.env['ARKVORY_MODULES_FILE'], root),
  );
  const core = blobs.core.lifecycle;
  const catalog = new PostgresCatalog(databaseUrl, capacity, writers);
  try {
    await catalog.ready();
    await core.ready();
    await catalog.claimStorage(await core.identity(), role);
    // Only the writer API records a storage seen for the first time; this process waits for it.
    // The worker rechecks them while it runs (`watchWorkerStorage`); maintenance runs once.
    await probeStorageBackends(blobs, new PostgresStorageIdentities(catalog.pool), {
      create: false,
    });
    return {
      catalog,
      blobs,
      // The validated root: mirror copies stage their parts under it.
      dataDirectory: root,
      staging: dataVolumeStaging(root, (bytes) => core.checkSpace(bytes)),
      /** New uploads of the worker (mirror copies) and the storage checks of completion. */
      placement: new PolicyPlacement(new PostgresPlacementPolicies(catalog.pool), blobs),
    };
  } catch (error) {
    await catalog.close();
    throw error;
  }
}

/** Pause between attempts of a standby worker to take the completion worker's lock. */
export const standbyRetryMs = 5000;

/**
 * Worker resources once this process is the database's completion worker. While another one
 * holds the lock this process waits as standby (reported once) instead of exiting and being
 * restarted in a loop; stopping it while it waits returns null.
 */
export async function workerResources(
  capacity: number,
  stop: AbortSignal,
  onStandby: () => void,
  retryMs = standbyRetryMs,
  writers = 2,
): Promise<Awaited<ReturnType<typeof resources>> | null> {
  let reported = false;
  while (!stop.aborted) {
    try {
      return await resources('worker', capacity, writers);
    } catch (error) {
      if (!(error instanceof WorkerSingletonBusy)) throw error;
      if (!reported) onStandby();
      reported = true;
      await delay(retryMs, undefined, { signal: stop }).catch(() => undefined);
    }
  }
  return null;
}

import { setTimeout as delay } from 'node:timers/promises';
import {
  LocalBlobStore,
  PostgresCatalog,
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

export async function resources(role: 'worker' | 'maintenance', capacity = 0) {
  const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
  const root = process.env['ARKVORY_DATA_DIR'];
  if (!databaseUrl || !root)
    throw new Error('ARKVORY_DATABASE_URL and ARKVORY_DATA_DIR are required');
  const blobs = new LocalBlobStore(
    root,
    storageReserveBytes(process.env['ARKVORY_STORAGE_RESERVE_BYTES']),
  );
  const catalog = new PostgresCatalog(databaseUrl, capacity, 2);
  try {
    await catalog.ready();
    await blobs.ready();
    await catalog.claimStorage(await blobs.identity(), role);
    return { catalog, blobs };
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
): Promise<Awaited<ReturnType<typeof resources>> | null> {
  let reported = false;
  while (!stop.aborted) {
    try {
      return await resources('worker', capacity);
    } catch (error) {
      if (!(error instanceof WorkerSingletonBusy)) throw error;
      if (!reported) onStandby();
      reported = true;
      await delay(retryMs, undefined, { signal: stop }).catch(() => undefined);
    }
  }
  return null;
}

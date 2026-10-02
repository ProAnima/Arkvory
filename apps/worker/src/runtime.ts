import {
  LocalBlobStore,
  PostgresCatalog,
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

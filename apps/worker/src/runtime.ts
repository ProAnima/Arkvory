import {
  LocalBlobStore,
  PostgresCatalog,
  storageReserveBytes,
} from '@proanima/arkvory-infrastructure';
export async function resources(role: 'worker' | 'maintenance') {
  const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
  const root = process.env['ARKVORY_DATA_DIR'];
  if (!databaseUrl || !root)
    throw new Error('ARKVORY_DATABASE_URL and ARKVORY_DATA_DIR are required');
  const blobs = new LocalBlobStore(
    root,
    storageReserveBytes(process.env['ARKVORY_STORAGE_RESERVE_BYTES']),
  );
  const catalog = new PostgresCatalog(databaseUrl, 0, 2);
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

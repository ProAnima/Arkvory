import { LocalBlobStore, PostgresCatalog } from '@proanima/depot-infrastructure';
export async function resources(role: 'worker' | 'maintenance') {
  const databaseUrl = process.env['DEPOT_DATABASE_URL'];
  const root = process.env['DEPOT_DATA_DIR'];
  if (!databaseUrl || !root) throw new Error('DEPOT_DATABASE_URL and DEPOT_DATA_DIR are required');
  const catalog = new PostgresCatalog(databaseUrl, 0, 2);
  const blobs = new LocalBlobStore(root);
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

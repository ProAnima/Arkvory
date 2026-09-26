import { normalizeRuntimeSettings } from '@proanima/arkvory-contracts';
import { LocalBlobStore, PostgresCatalog } from '@proanima/arkvory-infrastructure';
export async function resources(role: 'worker' | 'maintenance') {
  Object.assign(process.env, normalizeRuntimeSettings(process.env));
  const databaseUrl = process.env['ARKVORY_DATABASE_URL'];
  const root = process.env['ARKVORY_DATA_DIR'];
  if (!databaseUrl || !root)
    throw new Error('ARKVORY_DATABASE_URL and ARKVORY_DATA_DIR are required');
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

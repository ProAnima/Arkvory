import { Pool } from 'pg';
import { ModuleDerivedCache } from '@proanima/arkvory-infrastructure';

// Disposable local failure probe: the parent sends only its dedicated test schema/root.
process.once('message', async (options) => {
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 6,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => {});
  try {
    const cache = new ModuleDerivedCache({
      pool,
      dataDirectory: options.directory,
      moduleId: options.moduleId,
      quota: options.quota,
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
    });
    const build = await cache.begin('killed-build', options.quota, new AbortController().signal);
    if (!build) throw new Error('child build was not admitted');
    const sink = await build.create('inflight');
    await sink.write(Buffer.alloc(4096, 17));
    // Keep the sink and owner alive. Only the parent kills this process after receipt.
    process.send({ state: 'ready', ownerId: cache.ownerId });
  } catch (error) {
    process.send({ state: 'failed', error: error.stack });
    await pool.end();
    process.exitCode = 1;
    process.disconnect();
  }
});

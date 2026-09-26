import { PostgresCleanup } from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { resources } from './runtime.js';
try {
  const { catalog, blobs } = await resources('maintenance');
  let checked = 0,
    failed = 0;
  let after: string | undefined;
  try {
    const records = new PostgresCleanup(catalog.pool);
    for (;;) {
      const rows = await records.page(after, 100);
      if (!rows.length) break;
      for (const row of rows) {
        after = row.id;
        if (!catalog.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
        if (row.status !== 'available') continue;
        const upload = await catalog.get(row.repository, row.id);
        try {
          await blobs.verify(row.id, upload.descriptor, {
            throwIfAborted() {
              if (!catalog.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
            },
          });
          checked++;
        } catch {
          failed++;
          process.stdout.write(
            JSON.stringify({
              id: row.id,
              repository: row.repository,
              status: 'verification_failed',
            }) + '\n',
          );
        }
      }
    }
    process.stdout.write(JSON.stringify({ checked, failed }) + '\n');
    if (failed) process.exitCode = 1;
  } finally {
    await catalog.close();
  }
} catch {
  process.stderr.write('Scrub failed. Stop API and worker and verify maintenance configuration.\n');
  process.exitCode = 1;
}

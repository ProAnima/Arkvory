import { PostgresCleanup, failureCause } from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { BlobStore } from '@proanima/arkvory-application';
import { resources } from './runtime.js';
import { maintenanceFailed, maintenanceLogger } from './maintenance-log.js';

const diagnostics = await maintenanceLogger('scrub');
const started = performance.now();
try {
  const { catalog, blobs: local } = await resources('maintenance');
  // Through the port: each upload names the storage that holds it (ADR 0083, N9).
  const blobs: BlobStore = local;
  let checked = 0,
    failed = 0;
  let after: string | undefined;
  try {
    diagnostics.write({ level: 'info', component: 'maintenance', code: 'scrub.started' });
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
          const cancellation = {
            throwIfAborted() {
              if (!catalog.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
            },
          };
          await blobs.verify(row.id, upload.descriptor, cancellation, upload.storageBackend);
          checked++;
        } catch (error) {
          failed++;
          diagnostics.write({
            level: 'error',
            component: 'maintenance',
            code: 'scrub.verification_failed',
            artifactId: row.id,
            repository: row.repository,
            ...(error instanceof ArkvoryError ? { errorCode: error.code } : failureCause(error)),
          });
        }
      }
    }
    diagnostics.write({
      level: failed ? 'error' : 'info',
      component: 'maintenance',
      code: 'scrub.completed',
      checked,
      failed,
      durationMs: Math.round(performance.now() - started),
    });
    if (failed) process.exitCode = 1;
  } finally {
    await catalog.close();
  }
} catch (error) {
  maintenanceFailed(
    diagnostics,
    'scrub.failed',
    error,
    'Scrub failed. Stop API and worker and verify maintenance configuration.',
  );
}

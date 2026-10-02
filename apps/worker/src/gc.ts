import { GarbageCollector } from '@proanima/arkvory-application';
import { PostgresCleanup } from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { resources } from './runtime.js';
import { maintenanceFailed, maintenanceLogger } from './maintenance-log.js';

const diagnostics = await maintenanceLogger('gc');
const started = performance.now();
try {
  const { catalog, blobs } = await resources('maintenance');
  try {
    diagnostics.write({ level: 'info', component: 'maintenance', code: 'gc.started' });
    const result = await new GarbageCollector(new PostgresCleanup(catalog.pool), blobs, {
      throwIfAborted() {
        if (!catalog.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
      },
    }).run(new Date().toISOString());
    diagnostics.write({
      level: 'info',
      component: 'maintenance',
      code: 'gc.completed',
      visited: result.visited,
      collected: result.collected,
      deferred: result.deferred,
      durationMs: Math.round(performance.now() - started),
    });
  } finally {
    await catalog.close();
  }
} catch (error) {
  maintenanceFailed(
    diagnostics,
    'gc.failed',
    error,
    'GC failed. Stop the API and all workers; verify database, storage identity and permissions. Capacity is released only after deletion.',
  );
}

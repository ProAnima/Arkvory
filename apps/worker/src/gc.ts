import { GarbageCollector } from '@proanima/arkvory-application';
import { PostgresCleanup } from '@proanima/arkvory-infrastructure';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { resources } from './runtime.js';
try {
  const { catalog, blobs } = await resources('maintenance');
  try {
    const result = await new GarbageCollector(new PostgresCleanup(catalog.pool), blobs, {
      throwIfAborted() {
        if (!catalog.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
      },
    }).run(new Date().toISOString());
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await catalog.close();
  }
} catch {
  process.stderr.write(
    'GC failed. Stop the API and all workers; verify database, storage identity and permissions. Capacity is released only after deletion.\n',
  );
  process.exitCode = 1;
}

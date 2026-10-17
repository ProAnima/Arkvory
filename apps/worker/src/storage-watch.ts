import {
  PostgresStorageIdentities,
  storageChangeRecord,
  watchStorageBackends,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticLogger,
  PostgresCatalog,
  StorageBackends,
  StorageFault,
} from '@proanima/arkvory-infrastructure';

/**
 * Rechecks the volumes of the worker every 30 s (ADR 0083, N11) and logs each one that is not
 * usable at start or changes later, as the API does: completion and mirror copies of a volume
 * that is not available wait, and new mirror copies go to `default` meanwhile.
 */
export function watchWorkerStorage(
  blobs: StorageBackends,
  catalog: Pick<PostgresCatalog, 'pool'>,
  diagnostics: Pick<DiagnosticLogger, 'write'>,
): () => void {
  const changed = (id: string, fault: StorageFault | null) => {
    diagnostics.write(storageChangeRecord(id, fault));
  };
  for (const { id, fault } of blobs.status()) if (fault !== null) changed(id, fault);
  for (const id of blobs.unconfigured()) changed(id, 'not_configured');
  return watchStorageBackends(blobs, new PostgresStorageIdentities(catalog.pool), {
    create: false,
    changed,
  });
}

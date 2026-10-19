import { randomUUID } from 'node:crypto';
import {
  ArtifactCatalog,
  GlobalSearch,
  ScopedCatalog,
  StorageService,
} from '@proanima/arkvory-application';
import type { PostgresCatalog } from './postgres-catalog.js';
import type { StorageBackends } from './storage-backends.js';
import type { PostgresContentPins } from './content-pins.js';
import { PostgresBrowse } from './browse.js';
import { PostgresGlobalSearch } from './global-search.js';
import { ZipManifestReader } from './upack.js';

export function moduleCatalogSource(
  catalog: PostgresCatalog,
  blobs: StorageBackends,
  pins: PostgresContentPins,
): ScopedCatalog {
  const storage = new StorageService(catalog, blobs, {
    next: randomUUID,
    now: () => new Date().toISOString(),
  });
  return new ScopedCatalog(
    storage,
    new ArtifactCatalog(
      storage,
      new PostgresBrowse(catalog.pool),
      new ZipManifestReader(blobs, pins),
    ),
    new GlobalSearch(new PostgresGlobalSearch(catalog.pool)),
    pins,
  );
}

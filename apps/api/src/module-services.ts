import { randomUUID } from 'node:crypto';
import {
  ArtifactCatalog,
  GlobalSearch,
  ScopedCatalog,
  StorageService,
} from '@proanima/arkvory-application';
import {
  defaultStorageReserveBytes,
  defaultStorageReserveInodes,
  ModuleHostServices,
  PostgresBrowse,
  PostgresGlobalSearch,
  ZipManifestReader,
} from '@proanima/arkvory-infrastructure';
import type {
  PostgresCatalog,
  PostgresContentPins,
  StorageBackends,
} from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';

/**
 * The host services of the API process's modules (ADR 0083): the catalog use cases of
 * `/api/v1` for `catalog-read` and `content-read`, built only when a module uses one, and the
 * data directories on the data volume, read-only on a read gateway.
 */
export function apiHostServices(
  config: ServerConfig,
  role: 'api' | 'reader',
  resources: {
    readonly catalog: PostgresCatalog;
    readonly blobs: StorageBackends;
    readonly pins: PostgresContentPins;
  },
): ModuleHostServices {
  const { catalog, blobs, pins } = resources;
  return new ModuleHostServices({
    dataDirectory: config.dataDirectory,
    reserve: {
      bytes: config.storageReserveBytes ?? defaultStorageReserveBytes,
      inodes: config.storageReserveInodes ?? defaultStorageReserveInodes,
    },
    readOnly: role === 'reader',
    catalog: () => {
      // Reads only: no upload is created through this service, so placement is not needed.
      const storage = new StorageService(catalog, blobs, {
        next: randomUUID,
        now: () => new Date().toISOString(),
      });
      const browse = new ArtifactCatalog(
        storage,
        new PostgresBrowse(catalog.pool),
        new ZipManifestReader(blobs, pins),
      );
      const search = new GlobalSearch(new PostgresGlobalSearch(catalog.pool));
      return new ScopedCatalog(storage, browse, search, pins);
    },
  });
}

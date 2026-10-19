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
  ModuleStorages,
  ModuleUnlinkAdmission,
  PostgresBrowse,
  PostgresGlobalSearch,
  ZipManifestReader,
} from '@proanima/arkvory-infrastructure';
import type {
  PostgresCatalog,
  PostgresContentPins,
  StorageBackends,
  InstallationPlan,
} from '@proanima/arkvory-infrastructure';
import type { ApiModuleContext } from './modules.js';
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
  installation?: InstallationPlan<ApiModuleContext>,
): ModuleHostServices {
  const { catalog, blobs, pins } = resources;
  return new ModuleHostServices({
    dataDirectory: config.dataDirectory,
    dataPool: catalog.sessions,
    reserve: {
      bytes: config.storageReserveBytes ?? defaultStorageReserveBytes,
      inodes: config.storageReserveInodes ?? defaultStorageReserveInodes,
    },
    readOnly: role === 'reader',
    role,
    compute: (id) => installation?.prepared.get(id)?.compute?.(),
    storage: new ModuleStorages(
      blobs,
      role === 'reader',
      new ModuleUnlinkAdmission(catalog.sessions),
    ),
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

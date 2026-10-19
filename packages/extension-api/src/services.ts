import type { DerivedCache } from './derived-cache.js';
import type { UploadRead } from './upload-read.js';

import type { ComputePool } from './compute.js';
import type { ChangeFeed } from './change-feed.js';
import type { ModuleStorageRegistry, StagedCompletionRegistry } from './storage-backend.js';
import type { CatalogRead, ContentRead } from './catalog-read.js';
import type { LicenseService } from './license.js';
import type { ModuleDataDirectory } from './module-files.js';
import type { ModuleRoutes } from './routes.js';

/**
 * The type of each host service a host implements today (ADR 0083, section 2.4). A module finds
 * a service in `context.services` only when its manifest declared it in `uses`; the plan refuses
 * a module that declares one this host or the module's roles and source do not offer.
 */
export interface HostServiceTypes {
  readonly 'derived-cache': DerivedCache;
  readonly compute: ComputePool;
  readonly 'change-feed': ChangeFeed;
  readonly 'blob-store': ModuleStorageRegistry;
  readonly 'staged-completion': StagedCompletionRegistry;
  readonly routes: ModuleRoutes;
  readonly 'catalog-read': CatalogRead;
  readonly 'content-read': ContentRead;
  readonly 'upload-read': UploadRead;
  readonly 'data-directory': ModuleDataDirectory;
  /** Read-only licence view (ADR 0078, R2): signed ProAnimaStudio modules only (ADR 0082, 18). */
  readonly license: LicenseService;
}

/** Services available to a server module: filtered by declaration, process role and source. */
export type HostServices = { readonly [K in keyof HostServiceTypes]?: HostServiceTypes[K] };

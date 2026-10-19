import type { UploadRead } from './upload-read.js';
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
  readonly routes: ModuleRoutes;
  readonly 'catalog-read': CatalogRead;
  readonly 'content-read': ContentRead;
  readonly 'upload-read': UploadRead;
  readonly 'data-directory': ModuleDataDirectory;
  /** Read-only licence view (ADR 0078, R2): signed ProAnimaStudio modules only (ADR 0082, 18). */
  readonly license: LicenseService;
}

/** The services a module of the API process may receive; each is present only when declared. */
export type HostServices = { readonly [K in keyof HostServiceTypes]?: HostServiceTypes[K] };

import type { CatalogRead, ContentRead } from './catalog-read.js';
import type { ModuleDataDirectory } from './module-files.js';

/**
 * The type of each host service a host implements today (ADR 0083, section 2.4). A module finds
 * a service in `context.services` only when its manifest declared it in `uses`; the plan refuses
 * a module that declares one this host or the module's roles and source do not offer.
 */
export interface HostServiceTypes {
  readonly 'catalog-read': CatalogRead;
  readonly 'content-read': ContentRead;
  readonly 'data-directory': ModuleDataDirectory;
}

/** The services a module of the API process may receive; each is present only when declared. */
export type HostServices = { readonly [K in keyof HostServiceTypes]?: HostServiceTypes[K] };

import { MODULE_ROUTE_LIMIT, parseSemanticVersion } from '@proanima/arkvory-extension-api';
import type {
  ModuleJson,
  ModuleManifest,
  ModuleRoute,
  ModuleRoutes,
  ModuleTransferOffer,
} from '@proanima/arkvory-extension-api';
import { checkFragment, type CheckedFragment } from './extension-openapi.js';
import { checkRoutes, type CheckedRoute } from './extension-route-check.js';
import { ModuleSetupError } from './module-host.js';

/** A transfer protocol a running module serves, as `capabilities.transfer` lists it. */
export interface TransferOffer {
  readonly name: string;
  readonly versions: readonly string[];
  readonly module: string;
  readonly prefix: string;
}

/** What one module declared through the service `routes`, checked. */
export interface ModuleRouteSet {
  readonly module: string;
  readonly routes: readonly CheckedRoute[];
  /** Null only for a module without routes. */
  readonly fragment: CheckedFragment | null;
  readonly offers: readonly TransferOffer[];
}

interface Declaration {
  readonly manifest: ModuleManifest;
  readonly routes: unknown[];
  readonly fragments: unknown[];
  readonly offers: unknown[];
  sealed: boolean;
  readonly withdrawn: Set<string>;
  checkedOffers: readonly TransferOffer[];
}

const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_VERSIONS = 16;

function checkOffer(
  value: unknown,
  manifest: ModuleManifest,
  index: number,
  taken: ReadonlySet<string>,
): TransferOffer {
  const at = `/offers/${String(index)}`;
  const field = (key: string): unknown =>
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  if (manifest.kind !== 'transfer') throw new ModuleSetupError('transfer_invalid', at);
  const name = field('name');
  if (typeof name !== 'string' || !NAME.test(name) || taken.has(name))
    throw new ModuleSetupError('transfer_invalid', `${at}/name`);
  const versions: unknown = field('versions');
  if (
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > MAX_VERSIONS ||
    versions.some((v: unknown) => typeof v !== 'string' || parseSemanticVersion(v) === null) ||
    new Set(versions).size !== versions.length
  )
    throw new ModuleSetupError('transfer_invalid', `${at}/versions`);
  const prefix = field('prefix');
  if (typeof prefix !== 'string' || !manifest.routePrefixes.includes(prefix))
    throw new ModuleSetupError('transfer_invalid', `${at}/prefix`);
  return { name, versions: versions.map(String), module: manifest.id, prefix };
}

/**
 * The service `routes` of the API process (ADR 0083, N7 and N12). Each module that uses it gets
 * its own registrar for the time of `create`; `seal` then checks the routes, the OpenAPI
 * fragment and the transfer offers as untrusted input and keeps a checked copy. The process
 * serves only the sets of modules that are running once the start is over, so a module that
 * failed to start leaves no route behind.
 */
export class ModuleRouteRegistry {
  private readonly declarations = new Map<string, Declaration>();
  private readonly sets = new Map<string, ModuleRouteSet>();

  /** A fresh registrar for one module; a later `create` of the same module replaces it. */
  service(manifest: ModuleManifest): ModuleRoutes {
    const declaration: Declaration = {
      manifest,
      routes: [],
      fragments: [],
      offers: [],
      sealed: false,
      withdrawn: new Set(),
      checkedOffers: [],
    };
    this.declarations.set(manifest.id, declaration);
    this.sets.delete(manifest.id);
    const open = (list: unknown[], value: unknown) => {
      if (declaration.sealed) throw new TypeError('Module routes are declared during create');
      list.push(value);
    };
    return {
      add: (route: ModuleRoute) => {
        open(declaration.routes, route);
      },
      document: (fragment: ModuleJson) => {
        open(declaration.fragments, fragment);
      },
      withdrawTransfer: (name: string) => {
        if (typeof name !== 'string' || !NAME.test(name))
          throw new TypeError('Invalid transfer name');
        if (
          (declaration.sealed ? declaration.checkedOffers : declaration.offers).some(
            (offer) =>
              typeof offer === 'object' && offer !== null && Reflect.get(offer, 'name') === name,
          )
        )
          declaration.withdrawn.add(name);
      },
      offerTransfer: (offer: ModuleTransferOffer) => {
        open(declaration.offers, offer);
      },
    };
  }

  /**
   * Checks what the module declared while it was created and closes its registrar; throws
   * `ModuleSetupError`. A transfer name is unique in the process: a later module that offers
   * a name an earlier one holds is refused.
   */
  seal(manifest: ModuleManifest): void {
    const declaration = this.declarations.get(manifest.id);
    if (!declaration) return;
    declaration.sealed = true;
    const routes = checkRoutes(declaration.routes, manifest, MODULE_ROUTE_LIMIT);
    if (declaration.fragments.length > 1) throw new ModuleSetupError('openapi_invalid', '');
    const fragment = declaration.fragments[0];
    if (fragment === undefined && routes.length > 0)
      throw new ModuleSetupError('openapi_invalid', '');
    const taken = new Set(
      [...this.declarations.values()]
        .filter((entry) => entry !== declaration && this.sets.has(entry.manifest.id))
        .flatMap((entry) => entry.checkedOffers.map((offer) => offer.name)),
    );
    const offers: TransferOffer[] = [];
    declaration.offers.forEach((offer, index) => {
      const checked = checkOffer(offer, manifest, index, taken);
      taken.add(checked.name);
      offers.push(checked);
    });
    declaration.checkedOffers = offers;
    this.sets.set(manifest.id, {
      module: manifest.id,
      routes,
      fragment: fragment === undefined ? null : checkFragment(fragment, manifest, routes),
      get offers() {
        return offers.filter((offer) => !declaration.withdrawn.has(offer.name));
      },
    });
  }

  /** The checked sets of the given modules, in their order; modules without one are skipped. */
  of(ids: readonly string[]): ModuleRouteSet[] {
    return ids.flatMap((id) => {
      const set = this.sets.get(id);
      return set ? [set] : [];
    });
  }
}

import type { Pool } from 'pg';
import { PostgresModuleDataCoordinator } from './module-data-coordinator.js';
import type { ModuleCompute } from './module-compute.js';
import type { ModuleChangeFeed } from './module-feed.js';
import type { ModuleStorages } from './module-storage.js';
import { hostServiceAvailable, ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  CatalogRead,
  ContentRead,
  HostServices,
  ModuleDataDirectory,
  ModuleFiles,
  ModuleResources,
  ModuleRole,
  PlannedModule,
} from '@proanima/arkvory-extension-api';
import type { ScopedCatalog } from '@proanima/arkvory-application';
import { AccessScopes, moduleCatalog } from './module-catalog.js';
import { openModuleData } from './module-data.js';
import type { ModuleData } from './module-data.js';
import type { VolumeReserve } from './volume-space.js';

/** How often the data directories are counted again from the disk (ADR 0083, N6). */
export const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

const MIB = 1024 * 1024;

export interface HostServiceSources {
  /** ARKVORY_DATA_DIR, where `module-data/<id>/` lives. */
  readonly dataDirectory: string;
  readonly dataPool?: Pool;
  readonly reserve: VolumeReserve;
  /** A read gateway: data directories are read-only there. */
  readonly readOnly: boolean;
  readonly role?: ModuleRole;
  readonly storage?: ModuleStorages;
  readonly feed?: ModuleChangeFeed;
  readonly compute?: (id: string) => ModuleCompute | undefined;
  /** The catalog use cases, built when the first module that uses one is created. */
  readonly catalog: () => ScopedCatalog;
}

/**
 * A module's files while its directory opens: the port is given synchronously at `create`, the
 * directory is made and counted on the first use; until then the usage reads zero.
 */
function lazyFiles(
  opening: Promise<ModuleData>,
  area: (directory: ModuleDataDirectory) => ModuleFiles,
  quota: { readonly bytes: number; readonly files: number },
  opened: () => ModuleData | undefined,
): ModuleFiles {
  const files = async () => area((await opening).directory);
  return {
    create: async (name, options) => (await files()).create(name, options),
    read: async function* (name, range) {
      yield* (await files()).read(name, range);
    },
    stat: async (name) => (await files()).stat(name),
    rename: async (from, to) => {
      await (await files()).rename(from, to);
    },
    remove: async (name) => {
      await (await files()).remove(name);
    },
    list: async (prefix, after, limit) => (await files()).list(prefix, after, limit),
    usage: () => {
      const current = opened();
      return current
        ? area(current.directory).usage()
        : { bytes: 0, files: 0, quotaBytes: quota.bytes, quotaFiles: quota.files };
    },
  };
}

/**
 * The host services the core gives the modules of one process (ADR 0083, section 2.4): each
 * module receives only the services its manifest declared in `uses`; the plan already refused a
 * service this host, the module's roles or its source do not offer. Owns the data directories
 * and their periodic reconciliation until `close`.
 */
export class ModuleHostServices {
  private readonly computations = new Map<string, ModuleCompute>();
  private readonly moduleScopes = new Map<string, AccessScopes>();
  private scoped: ScopedCatalog | undefined;
  private readonly data = new Map<string, { opening: Promise<ModuleData>; opened?: ModuleData }>();
  private readonly openings = new Set<Promise<ModuleData>>();
  private timer: ReturnType<typeof setInterval> | undefined;

  private readonly coordinator: PostgresModuleDataCoordinator | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly sources: HostServiceSources) {
    if (!sources.readOnly && sources.dataPool)
      this.coordinator = new PostgresModuleDataCoordinator(sources.dataPool);
  }

  /** The services of one module; `resources` is the approved size of its data directory. */
  for(module: PlannedModule, resources: ModuleResources | null): HostServices {
    if (this.closing) throw new ModuleServiceError('unavailable');
    const role = this.sources.role ?? (this.sources.readOnly ? 'reader' : 'api');
    const uses = (name: string) =>
      module.manifest.uses.includes(name) && hostServiceAvailable(name, role, module.source);
    const catalog =
      uses('catalog-read') || uses('content-read') ? this.catalog(module.manifest.id) : undefined;
    const compute = uses('compute') ? this.sources.compute?.(module.manifest.id) : undefined;
    if (compute) this.computations.set(module.manifest.id, compute);
    return {
      ...(compute ? { compute } : {}),
      ...(uses('change-feed') && this.sources.feed
        ? { 'change-feed': this.sources.feed.for(module.manifest.id) }
        : {}),
      ...(uses('blob-store') && this.sources.storage
        ? { 'blob-store': this.sources.storage.storage(module.manifest.id) }
        : {}),
      ...(uses('staged-completion') && this.sources.storage
        ? { 'staged-completion': this.sources.storage.staged(module.manifest.id) }
        : {}),
      ...(catalog && uses('catalog-read') ? { 'catalog-read': catalog.catalog } : {}),
      ...(catalog && uses('content-read') ? { 'content-read': catalog.content } : {}),
      ...(uses('data-directory')
        ? { 'data-directory': this.directory(module.manifest.id, resources) }
        : {}),
    };
  }

  seal(moduleId: string): void {
    this.sources.storage?.seal(moduleId);
  }
  activate(moduleId: string): void {
    this.sources.storage?.active(moduleId, true);
    this.sources.feed?.activate(moduleId);
  }
  withdraw(moduleId: string): void {
    this.sources.storage?.active(moduleId, false);
    this.sources.feed?.stop(moduleId);
    void this.computations
      .get(moduleId)
      ?.close()
      .catch(() => undefined);
  }

  /**
   * The scopes of one module (ADR 0083, N4): the host makes a module's scopes here, from the
   * principal of the module's request or its service principal, and only that module's
   * services read with them.
   */
  scopes(moduleId: string): AccessScopes {
    let scopes = this.moduleScopes.get(moduleId);
    if (!scopes) {
      scopes = new AccessScopes();
      this.moduleScopes.set(moduleId, scopes);
    }
    return scopes;
  }

  private catalog(moduleId: string): {
    readonly catalog: CatalogRead;
    readonly content: ContentRead;
  } {
    this.scoped ??= this.sources.catalog();
    return moduleCatalog(this.scoped, this.scopes(moduleId));
  }

  private directory(moduleId: string, resources: ModuleResources | null): ModuleDataDirectory {
    // Without an approved size the module may read but every write exceeds its quota.
    const quota = { bytes: (resources?.dataMiB ?? 0) * MIB, files: resources?.dataFiles ?? 0 };
    const entry: { opening: Promise<ModuleData>; opened?: ModuleData } = {
      opening: openModuleData({
        dataDirectory: this.sources.dataDirectory,
        moduleId,
        ...(this.coordinator ? { coordinator: this.coordinator } : {}),
        quota,
        reserve: this.sources.reserve,
        readOnly: this.sources.readOnly,
        ...(this.sources.storage
          ? { requireRemoval: () => this.sources.storage?.removal(moduleId).require() }
          : {}),
      }).then((opened) => {
        entry.opened = opened;
        return opened;
      }),
    };
    // A failure to open reaches the module on its first use, not as an unhandled rejection.
    entry.opening.catch(() => undefined);
    this.openings.add(entry.opening);
    this.data.set(moduleId, entry);
    this.timer ??= setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.timer.unref();
    const opened = () => entry.opened;
    return {
      data: lazyFiles(entry.opening, (d) => d.data, quota, opened),
      cache: lazyFiles(entry.opening, (d) => d.cache, quota, opened),
    };
  }

  /** Counts every opened directory again; a failure keeps the previous counts. */
  async reconcile(): Promise<void> {
    for (const { opened } of this.data.values()) await opened?.reconcile().catch(() => undefined);
  }

  close(): Promise<void> {
    return (this.closing ??= this.closeOwned());
  }

  private async closeOwned(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    // Compute may still use module resources until termination has completed.
    const computeResults = await Promise.allSettled(
      [...this.computations.values()].map((compute) => compute.close()),
    );
    const results = await Promise.allSettled([
      ...[...this.openings].map(async (opening) => {
        const data = await opening.catch(() => undefined);
        await data?.close();
      }),
      Promise.resolve().then(() => this.sources.feed?.close()),
    ]);
    // Release the owner lock only after all sinks have relinquished their OS handles.
    await this.coordinator?.close();
    const errors = [...computeResults, ...results].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length) throw new AggregateError(errors, 'Module host close failed');
  }
}

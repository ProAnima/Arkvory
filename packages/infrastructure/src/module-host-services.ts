import type {
  CatalogRead,
  ContentRead,
  HostServices,
  LicenseService,
  ModuleDataDirectory,
  ModuleFiles,
  ModuleResources,
  PlannedModule,
} from '@proanima/arkvory-extension-api';
import { moduleUploads } from './module-upload-read.js';
import type { ScopedUploads, ScopedCatalog } from '@proanima/arkvory-application';
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
  readonly reserve: VolumeReserve;
  /** A read gateway: data directories are read-only there. */
  readonly readOnly: boolean;
  /** The catalog use cases, built when the first module that uses one is created. */
  readonly catalog: () => ScopedCatalog;
  readonly uploads?: () => ScopedUploads;
  /**
   * The `license` service (ADR 0078, R2), built on first use; absent, no module receives it.
   * Reading it never calls the hub: it reads what the writer stored (ADR 0078, I1).
   */
  readonly license?: () => LicenseService;
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
  private readonly lifetime = new AbortController();
  private readonly moduleScopes = new Map<string, AccessScopes>();
  private scoped: ScopedCatalog | undefined;
  private readonly data = new Map<string, { opening: Promise<ModuleData>; opened?: ModuleData }>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly sources: HostServiceSources) {}

  /** The services of one module; `resources` is the approved size of its data directory. */
  for(module: PlannedModule, resources: ModuleResources | null): HostServices {
    const uses = (name: string) => module.manifest.uses.includes(name);
    const catalog =
      uses('catalog-read') || uses('content-read') ? this.catalog(module.manifest.id) : undefined;
    return {
      ...(uses('upload-read') && this.sources.uploads
        ? { 'upload-read': moduleUploads(this.sources.uploads(), this.scopes(module.manifest.id)) }
        : {}),
      ...(catalog && uses('catalog-read') ? { 'catalog-read': catalog.catalog } : {}),
      ...(catalog && uses('content-read') ? { 'content-read': catalog.content } : {}),
      ...(uses('data-directory')
        ? { 'data-directory': this.directory(module.manifest.id, resources) }
        : {}),
      ...this.license(module),
    };
  }

  /**
   * The plan already refuses `license` to operator and development plugins (ADR 0082, 18); the
   * host gives it to signed modules only, so a built-in module never reads licences either.
   */
  private license(module: PlannedModule): Pick<HostServices, 'license'> {
    const { license } = this.sources;
    const granted = module.source === 'signed' && module.manifest.uses.includes('license');
    return granted && license ? { license: license() } : {};
  }

  /**
   * The scopes of one module (ADR 0083, N4): the host makes a module's scopes here, from the
   * principal of the module's request or its service principal, and only that module's
   * services read with them.
   */
  scopes(moduleId: string): AccessScopes {
    let scopes = this.moduleScopes.get(moduleId);
    if (!scopes) {
      scopes = new AccessScopes(this.lifetime.signal);
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
        quota,
        reserve: this.sources.reserve,
        readOnly: this.sources.readOnly,
      }).then((opened) => {
        entry.opened = opened;
        return opened;
      }),
    };
    // A failure to open reaches the module on its first use, not as an unhandled rejection.
    entry.opening.catch(() => undefined);
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

  /** Revoke request authority before shutdown waits for the modules or HTTP streams. */
  stop(): void {
    this.lifetime.abort();
  }

  close(): void {
    this.stop();
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

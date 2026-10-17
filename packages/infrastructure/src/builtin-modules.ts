import {
  EXTENSION_API_VERSION,
  MODULE_MANIFEST_FORMAT,
  ModuleConfigError,
  parseSemanticVersion,
} from '@proanima/arkvory-extension-api';
import type {
  ModuleDescriptor,
  ModuleLifecycle,
  ModuleManifest,
} from '@proanima/arkvory-extension-api';
import {
  describeLocalStorageConfig,
  LOCAL_STORAGE_MODULE,
  parseLocalStorageConfig,
} from './storage-backend-config.js';
import type { LocalStorageConfig } from './storage-backend-config.js';

type NoSettings = Readonly<Record<string, never>>;

/** Built-in modules take no settings yet: nothing, or an empty object. */
function noSettings(input: unknown): NoSettings {
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ModuleConfigError('type', '');
  const field = Object.keys(input)[0];
  if (field !== undefined) throw new ModuleConfigError('unknown_field', `/${field}`);
  return {};
}

/**
 * The protocols' routes are registered by the API process and their services built there and in
 * the worker (ADR 0079, 5.7); the module itself holds no resources yet, so its lifecycle has
 * nothing to acquire or release and it is healthy whenever the process is.
 */
function wiredByCore(): ModuleLifecycle {
  return {
    start: () => Promise.resolve(),
    drain: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    health: () => ({ status: 'ok', code: null }),
  };
}

type Description = Pick<ModuleManifest, 'id' | 'core' | 'roles' | 'routePrefixes' | 'tablePrefix'>;

/** The core and the modules it signs are published by ProAnimaStudio (ADR 0083, section 2.3). */
export const CORE_PUBLISHER = 'proanimastudio';

/** A built-in protocol; its descriptor ignores the context, whichever process creates it. */
function protocol(
  version: string,
  description: Description,
): ModuleDescriptor<unknown, NoSettings> {
  return {
    manifest: {
      format: MODULE_MANIFEST_FORMAT,
      version,
      extensionApi: `^${EXTENSION_API_VERSION}`,
      kind: 'protocol',
      publisher: CORE_PUBLISHER,
      uses: [],
      requires: [],
      provides: [],
      metricPrefix: null,
      ...description,
    },
    parseConfig: noSettings,
    describeConfig: () => ({}),
    create: wiredByCore,
  };
}

/**
 * The core's storage (ADR 0079, sections 5.1 and 8; ADR 0083, N11): `default` at
 * ARKVORY_DATA_DIR and the instances of its settings, such as a second volume. The processes
 * build the instances from these settings themselves (`localStorageBackends`); every process
 * that reads or writes content runs it. It is core while it is the only storage of the core:
 * new uploads fall back to it.
 */
function localStorage(version: string): ModuleDescriptor<unknown, LocalStorageConfig> {
  return {
    manifest: {
      format: MODULE_MANIFEST_FORMAT,
      version,
      extensionApi: `^${EXTENSION_API_VERSION}`,
      kind: 'storage-backend',
      publisher: CORE_PUBLISHER,
      uses: [],
      requires: [],
      provides: [],
      metricPrefix: null,
      id: LOCAL_STORAGE_MODULE,
      core: true,
      roles: ['api', 'reader', 'worker', 'backup'],
      routePrefixes: [],
      tablePrefix: null,
    },
    parseConfig: parseLocalStorageConfig,
    describeConfig: describeLocalStorageConfig,
    create: wiredByCore,
  };
}

/**
 * The built-in modules of the release, explicitly (ADR 0079, section 8). One list for every
 * process: the plan and its fingerprint are those of the installation, so the API, its read
 * gateways and the worker must plan the same modules. Built-in modules carry the core's version.
 * UPack and raw files are the free core and cannot be disabled; the protocols beside /api/v1 can.
 * The worker writes registry rows of mirrored images and npm packages, hence its role for `oci`
 * and `npm`.
 */
export function builtinModules(
  version: string,
): readonly ModuleDescriptor<unknown, NoSettings | LocalStorageConfig>[] {
  return [
    localStorage(version),
    protocol(version, {
      id: 'upack',
      core: true,
      roles: ['api', 'reader', 'worker'],
      routePrefixes: [],
      tablePrefix: null,
    }),
    protocol(version, {
      id: 'raw',
      core: true,
      roles: ['api', 'reader'],
      routePrefixes: [],
      tablePrefix: null,
    }),
    protocol(version, {
      id: 'oci',
      core: false,
      roles: ['api', 'reader', 'worker'],
      routePrefixes: ['/v2/'],
      tablePrefix: 'arkvory_oci_',
    }),
    protocol(version, {
      id: 'lfs',
      core: false,
      roles: ['api', 'reader'],
      routePrefixes: ['/lfs/'],
      tablePrefix: 'arkvory_lfs_',
    }),
    protocol(version, {
      id: 'npm',
      core: false,
      roles: ['api', 'reader', 'worker'],
      routePrefixes: ['/npm/'],
      tablePrefix: 'arkvory_npm_',
    }),
  ];
}

/** The core's own routes, which no module may claim. */
export const CORE_ROUTE_PREFIXES: readonly string[] = ['/api/v1/', '/health/', '/console/'];

/** A release version as is; a development build (`dev`) as the pre-release `0.0.0-dev`. */
export function builtinVersion(coreVersion: string): string {
  const parsed = parseSemanticVersion(coreVersion);
  return parsed ? coreVersion : '0.0.0-dev';
}

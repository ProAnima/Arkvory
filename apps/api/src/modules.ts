import { createHash } from 'node:crypto';
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
  ModuleSignal,
} from '@proanima/arkvory-extension-api';
import { ModuleRuntime, planOrThrow, prepareModule } from './module-host.js';

/** What a built-in module of the API process may receive from the core. */
export interface ApiModuleContext {
  readonly role: 'api' | 'reader';
}

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
 * The protocols' routes are registered by `registerProtocolRoutes` and their services built by
 * `createApiServices` (ADR 0079, 5.7); the module itself holds no resources yet, so its
 * lifecycle has nothing to acquire or release and it is healthy whenever the process is.
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

function protocol(
  version: string,
  description: Description,
): ModuleDescriptor<ApiModuleContext, NoSettings> {
  return {
    manifest: {
      format: MODULE_MANIFEST_FORMAT,
      version,
      extensionApi: `^${EXTENSION_API_VERSION}`,
      kind: 'protocol',
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
 * The built-in modules of the API process, explicitly (ADR 0079, section 8). Built-in modules
 * carry the core's version. UPack and raw files are the free core and cannot be disabled; the
 * protocols beside /api/v1 can be described and later disabled. The worker writes registry rows
 * of mirrored images and npm packages, hence its role for `oci` and `npm`.
 */
export function builtinModules(version: string) {
  return [
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
export const CORE_ROUTE_PREFIXES = ['/api/v1/', '/health/', '/console/'];

/** A release version as is; a development build (`dev`) as the pre-release `0.0.0-dev`. */
export function builtinVersion(coreVersion: string): string {
  const parsed = parseSemanticVersion(coreVersion);
  return parsed ? coreVersion : '0.0.0-dev';
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Plans and starts the modules of this API process: every built-in module enabled, as before
 * modules existed. Each configuration is parsed and the plan checked before any module starts.
 */
export function startApiModules(
  role: ApiModuleContext['role'],
  coreVersion: string,
  signal: ModuleSignal,
): Promise<ModuleRuntime> {
  const prepared = new Map(
    builtinModules(builtinVersion(coreVersion)).map((descriptor) => [
      descriptor.manifest.id,
      prepareModule(descriptor),
    ]),
  );
  const plan = planOrThrow(prepared, {
    coreVersion,
    extensionApi: EXTENSION_API_VERSION,
    reservedRoutePrefixes: CORE_ROUTE_PREFIXES,
    sha256,
  });
  return ModuleRuntime.start(plan, prepared, { role, context: { role }, signal });
}

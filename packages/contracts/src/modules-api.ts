import { items, record, text } from './wire-values.js';

/** Modules of the installation (ADR 0078, 8; ADR 0079, 9): [path, method, operationId, access, retry]. */
export const moduleOperations = [
  ['/system/modules', 'get', 'getSystemModules', 'administrator', 'read'],
  ['/system/modules/{id}/openapi', 'get', 'getSystemModuleOpenApi', 'administrator', 'read'],
] as const;

export interface SystemModuleHealth {
  /**
   * `ok`, `degraded`, `failed`, `revoked` or `unavailable`; later versions may add states,
   * unknown ones mean not ok.
   */
  readonly status: string;
  readonly code: string | null;
}

/** One module as the installation plans it; no settings, paths or secrets. */
export interface SystemModule {
  readonly id: string;
  readonly version: string;
  /** The extension point: `protocol`, `storage-backend`, …; later versions may add points. */
  readonly kind: string;
  /** `builtin` or `signed`. */
  readonly source: string;
  /** Part of the free core; never disabled. */
  readonly core: boolean;
  readonly enabled: boolean;
  readonly roles: readonly string[];
  /** Whether the answering process runs the module. */
  readonly running: boolean;
  /**
   * Health in the answering process; null when it does not run the module there. An installed
   * signed module that was refused or failed to start shows `failed`, `revoked` or `unavailable`
   * with the code while `running` is false.
   */
  readonly health: SystemModuleHealth | null;
}

export interface SystemModules {
  /** The extension API version of this core. */
  readonly extensionApi: string;
  /**
   * SHA-256 of the exact plan: the core version and every module version, source, package hash,
   * choice and settings. Equal for equal plans of one release; another release gives another one.
   */
  readonly fingerprint: string;
  /**
   * SHA-256 of what the processes of the installation must agree on: modules, sources, extension
   * points, choices, settings and, for modules that are not built in, their compatibility line,
   * without the core version. A read gateway or worker is ready only with the writer's value.
   * Absent on servers before it was added.
   */
  readonly compatibilityFingerprint?: string;
  readonly modules: readonly SystemModule[];
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const word = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$', maxLength: 64 };
const code = { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$', maxLength: 64, nullable: true };
const version = { type: 'string', minLength: 5, maxLength: 64 };
const health = { ...object({ status: word, code }), nullable: true };

const sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' };

export const systemModulesSchema = object({
  extensionApi: version,
  fingerprint: sha256,
  compatibilityFingerprint: sha256,
  modules: {
    type: 'array',
    maxItems: 256,
    items: object({
      id: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,31}$' },
      version,
      kind: word,
      source: word,
      core: { type: 'boolean' },
      enabled: { type: 'boolean' },
      roles: { type: 'array', maxItems: 8, items: word },
      running: { type: 'boolean' },
      health,
    }),
  },
});

/**
 * The OpenAPI 3.1 document of one module's routes as the core serves them (ADR 0083, N12): the
 * module's fragment with what the core checks per operation (`x-arkvory-*`) and the core's
 * security scheme. Its paths and schemas belong to the module, so only the frame is fixed here.
 */
export const moduleDocumentSchema = {
  type: 'object',
  required: ['openapi', 'info', 'paths', 'components'],
  properties: {
    openapi: { type: 'string', pattern: '^3\\.1\\.' },
    info: {
      type: 'object',
      required: ['title', 'version'],
      properties: { title: { type: 'string' }, version: sha256 },
    },
    paths: { type: 'object' },
    components: { type: 'object' },
  },
};

export const modulePaths = {
  '/api/v1/system/modules': {
    get: {
      summary:
        'List the modules of this installation: version, extension point, whether core and enabled, health in the answering process, and the plan fingerprints',
      responses: {
        200: {
          description:
            'Every planned module and every installed signed module the loader refused, in id order; no settings, paths or secrets',
          content: { 'application/json': { schema: systemModulesSchema } },
        },
      },
    },
  },
  '/api/v1/system/modules/{id}/openapi': {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,31}$' },
      },
    ],
    get: {
      summary:
        'Get the OpenAPI document of the routes one module serves under /api/ext/ in the answering process',
      responses: {
        200: {
          description:
            'The module fragment, checked against its routes, with the access checks of the core per operation; info.version is the plan fingerprint. A module that serves no routes in the answering process is not_found',
          content: { 'application/json': { schema: moduleDocumentSchema } },
        },
      },
    },
  },
};

const flag = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
  return value;
};

function readHealth(value: unknown): SystemModuleHealth | null {
  if (value === null) return null;
  const row = record(value);
  return { status: text(row['status']), code: row['code'] === null ? null : text(row['code']) };
}

function readModule(value: unknown): SystemModule {
  const row = record(value);
  return {
    id: text(row['id']),
    version: text(row['version']),
    kind: text(row['kind']),
    source: text(row['source']),
    core: flag(row['core']),
    enabled: flag(row['enabled']),
    roles: items(row['roles']).map(text),
    running: flag(row['running']),
    health: readHealth(row['health']),
  };
}

function digest(value: unknown): string {
  const fingerprint = text(value);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid server fingerprint');
  return fingerprint;
}

/** Validates `GET /api/v1/system/modules`; new fields of a newer server are left out. */
export function readSystemModules(value: unknown): SystemModules {
  const row = record(value);
  const compatibility = row['compatibilityFingerprint'];
  return {
    extensionApi: text(row['extensionApi']),
    fingerprint: digest(row['fingerprint']),
    ...(compatibility === undefined ? {} : { compatibilityFingerprint: digest(compatibility) }),
    modules: items(row['modules']).map(readModule),
  };
}

/** One transfer protocol a module serves (ADR 0079, 5.2), from `capabilities.transfer`. */
export interface TransferCapability {
  /** Matched with the name of a client's transfer extension. */
  readonly name: string;
  /** Semver versions the server speaks; a client picks the highest one it shares. */
  readonly versions: readonly string[];
  /** The module serving it. */
  readonly module: string;
  /** Path prefix of its routes, `/api/ext/<module>/v<major>/`. */
  readonly prefix: string;
}

/** Validates `capabilities.transfer`; fields a newer server adds are left out. */
export function readTransferCapabilities(value: unknown): readonly TransferCapability[] {
  return items(value).map((entry) => {
    const row = record(entry);
    const versions = items(row['versions']).map(text);
    const prefix = text(row['prefix']);
    if (versions.length === 0 || !prefix.startsWith('/api/ext/'))
      throw new Error('Invalid server transfer capability');
    return { name: text(row['name']), versions, module: text(row['module']), prefix };
  });
}

/** `GET /api/v1/system/modules/{id}/openapi`: the frame is checked, the module's paths are not. */
export function readModuleDocument(value: unknown): Readonly<Record<string, unknown>> {
  const row = record(value);
  const openapi = text(row['openapi']);
  const version = text(record(row['info'])['version']);
  record(row['paths']);
  if (!openapi.startsWith('3.1.') || !/^[0-9a-f]{64}$/.test(version))
    throw new Error('Invalid server module document');
  return row;
}

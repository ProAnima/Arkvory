import { items, record, text } from './wire-values.js';

/** Modules of the installation (ADR 0078, 8; ADR 0079, 9): [path, method, operationId, access, retry]. */
export const moduleOperations = [
  ['/system/modules', 'get', 'getSystemModules', 'administrator', 'read'],
] as const;

export interface SystemModuleHealth {
  /** `ok`, `degraded` or `failed`; later versions may add states, unknown ones mean not ok. */
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
  /** Health in the answering process; null when it does not run the module there. */
  readonly health: SystemModuleHealth | null;
}

export interface SystemModules {
  /** The extension API version of this core. */
  readonly extensionApi: string;
  /** SHA-256 of the plan, equal on every process of one installation. */
  readonly fingerprint: string;
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

export const systemModulesSchema = object({
  extensionApi: version,
  fingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
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

export const modulePaths = {
  '/api/v1/system/modules': {
    get: {
      summary:
        'List the modules of this installation: version, extension point, whether core and enabled, health in the answering process, and the plan fingerprint',
      responses: {
        200: {
          description: 'Every planned module in id order; no settings, paths or secrets',
          content: { 'application/json': { schema: systemModulesSchema } },
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

/** Validates `GET /api/v1/system/modules`; new fields of a newer server are left out. */
export function readSystemModules(value: unknown): SystemModules {
  const row = record(value);
  const fingerprint = text(row['fingerprint']);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('Invalid server fingerprint');
  return {
    extensionApi: text(row['extensionApi']),
    fingerprint,
    modules: items(row['modules']).map(readModule),
  };
}

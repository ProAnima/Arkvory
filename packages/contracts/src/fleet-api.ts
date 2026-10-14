import { readinessSchema } from './health.js';

/** Fleet operations of ADR 0077: [path, method, operationId, access, retry]. */
export const fleetOperations = [
  ['/system/topology', 'get', 'getSystemTopology', 'administrator', 'read'],
  ['/system/fleet/pairings', 'post', 'createFleetPairing', 'administrator', 'never-automatic'],
  ['/system/fleet/controllers', 'get', 'listFleetControllers', 'administrator', 'read'],
  [
    '/system/fleet/controllers/{id}',
    'delete',
    'revokeFleetController',
    'administrator',
    'idempotent',
  ],
  ['/system/fleet/enrollment', 'post', 'enrollFleetController', 'public', 'never-automatic'],
] as const;

const object = (properties: Record<string, unknown>, optional: readonly string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties).filter((name) => !optional.includes(name)),
  properties,
});
const nullable = (schema: Record<string, unknown>) => ({ ...schema, nullable: true });
const text = { type: 'string' };
const time = { type: 'string', format: 'date-time' };
const count = { type: 'integer', minimum: 0 };
const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]*)$' };

const site = object({
  name: text,
  version: text,
  schema: count,
  role: { type: 'string', enum: ['api', 'reader'] },
});
const health = object({
  available: { type: 'boolean' },
  writable: { type: 'boolean' },
  draining: { type: 'boolean' },
});
/** The same view of HA copies as the administrator's readiness (ADR 0072). */
const replication = readinessSchema.properties.replication;
const gateway = object({ slot: count, active: { type: 'boolean' }, expiresAt: time });
const mirror = object({
  repository: text,
  mode: { type: 'string', enum: ['mirror', 'import'] },
  upstream: text,
  sourceRepository: text,
  phase: text,
  errorCode: nullable(text),
  checkedAt: nullable(time),
  syncedAt: nullable(time),
  /** Changes of the source not yet applied: source head minus cursor; null before the first check. */
  lagChanges: nullable(decimal),
  copiedArtifacts: count,
  copiedBytes: decimal,
});
const updates = nullable(
  object({
    currentVersion: text,
    latest: nullable(text),
    phase: text,
    error: nullable(text),
    automatic: { type: 'boolean' },
    heartbeatAt: time,
  }),
);
const downloads = object({
  strategy: { type: 'string', enum: ['ordered', 'smallest-first', 'shared'] },
  sessions: count,
  active: count,
  waiting: count,
  oldestWaitSeconds: count,
  bytesPerSecond: count,
});

/** One installation as the fleet console sees it (ADR 0077): no secrets, no user data. */
export const topologySchema = object({
  collectedAt: time,
  site,
  health,
  replication,
  gateways: { type: 'array', maxItems: 16, items: gateway },
  mirrors: { type: 'array', maxItems: 64, items: mirror },
  updates,
  downloads,
});

const controller = object({
  id: { type: 'string', format: 'uuid' },
  name: text,
  pairedBy: text,
  pairedAt: time,
  usedAt: nullable(time),
});
const json = (schema: unknown) => ({ 'application/json': { schema } });

export const fleetPaths = {
  '/api/v1/system/fleet/pairings': {
    post: {
      summary:
        'Make a one-time pairing code, valid ten minutes, that lets a controller manage this site',
      responses: {
        201: {
          description: 'The code is shown once; give it to the administrator of the controller',
          content: json(
            object({
              code: { type: 'string', pattern: '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$' },
              expiresAt: time,
            }),
          ),
        },
      },
    },
  },
  '/api/v1/system/fleet/controllers': {
    get: {
      summary: 'List the controllers that manage this site',
      responses: {
        200: {
          description: 'Live controllers, oldest first',
          content: json(object({ items: { type: 'array', maxItems: 100, items: controller } })),
        },
      },
    },
  },
  '/api/v1/system/fleet/controllers/{id}': {
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    delete: {
      summary: 'Revoke a controller: its fleet key is refused at once',
      responses: { 204: { description: 'Revoked' } },
    },
  },
  '/api/v1/system/fleet/enrollment': {
    post: {
      summary:
        'Trade a pairing code for a fleet key, once. Called by the controller over TLS it has pinned',
      security: [],
      requestBody: {
        required: true,
        content: json(
          object({
            code: { type: 'string', maxLength: 32 },
            name: { type: 'string', minLength: 1, maxLength: 63 },
          }),
        ),
      },
      responses: {
        201: {
          description: 'The key is returned once and never shown again',
          content: json(
            object({
              key: { type: 'string', pattern: '^afk_[A-Za-z0-9_-]{43}$' },
              site: object({ name: text, version: text }),
            }),
          ),
        },
      },
    },
  },
  '/api/v1/system/topology': {
    get: {
      summary:
        'Read this installation as one site of a fleet: role, health, HA copies, read gateways, mirrors with their lag, updates and the download queue',
      responses: {
        200: {
          description: 'The current state; collected on each request',
          content: { 'application/json': { schema: topologySchema } },
        },
      },
    },
  },
};

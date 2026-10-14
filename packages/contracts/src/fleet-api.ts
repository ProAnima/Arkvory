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
  ['/fleet/sites', 'get', 'listFleetSites', 'administrator', 'read'],
  ['/fleet/sites', 'post', 'addFleetSite', 'administrator', 'never-automatic'],
  ['/fleet/sites/probe', 'post', 'probeFleetSite', 'administrator', 'idempotent'],
  ['/fleet/sites/{id}', 'delete', 'removeFleetSite', 'administrator', 'idempotent'],
  ['/fleet/sites/{id}/refresh', 'post', 'refreshFleetSite', 'administrator', 'idempotent'],
  ['/fleet/sites/{id}/read', 'get', 'readFleetSite', 'administrator', 'read'],
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

const fingerprint = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const siteId = { type: 'string', format: 'uuid' };
/** A managed site as the controller shows it: never its key. */
export const fleetSiteSchema = object({
  id: siteId,
  name: text,
  url: text,
  fingerprint: nullable(fingerprint),
  addedBy: text,
  addedAt: time,
  seenAt: nullable(time),
  state: {
    type: 'string',
    enum: ['pending', 'ok', 'unreachable', 'certificate', 'revoked', 'invalid', 'refused'],
  },
  error: nullable(text),
  topology: nullable(topologySchema),
});
const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: siteId,
};

export const fleetPaths = {
  '/api/v1/fleet/sites': {
    get: {
      summary: 'List the sites this installation manages, with the state each last reported',
      responses: {
        200: {
          description: 'Sites by name',
          content: json(
            object({ items: { type: 'array', maxItems: 256, items: fleetSiteSchema } }),
          ),
        },
      },
    },
    post: {
      summary:
        'Pair with a site: its certificate must match the confirmed fingerprint, the code is traded for a key that stays sealed here',
      requestBody: {
        required: true,
        content: json(
          object({
            url: text,
            fingerprint: nullable(fingerprint),
            code: { type: 'string', maxLength: 32 },
          }),
        ),
      },
      responses: { 201: { description: 'Paired and read once', content: json(fleetSiteSchema) } },
    },
  },
  '/api/v1/fleet/sites/probe': {
    post: {
      summary:
        'Read the certificate a site presents, to compare its fingerprint with the one the site shows before pairing',
      requestBody: { required: true, content: json(object({ url: text })) },
      responses: {
        200: {
          description: 'Null certificate for plain HTTP on loopback',
          content: json(
            object({
              url: text,
              certificate: nullable(
                object({ fingerprint, subject: text, issuer: text, validTo: time }),
              ),
            }),
          ),
        },
      },
    },
  },
  '/api/v1/fleet/sites/{id}': {
    parameters: [idParameter],
    delete: {
      summary: 'Forget a site here; revoke this controller on the site as well',
      responses: { 204: { description: 'Forgotten' } },
    },
  },
  '/api/v1/fleet/sites/{id}/read': {
    parameters: [
      idParameter,
      {
        name: 'path',
        in: 'query',
        required: true,
        description:
          'A read route of the site with its query, from the fixed list of catalog metadata routes: repositories, search, artifacts, annotations, stages, packages, file pages and history, storage usage, mirror state. Never file bytes.',
        schema: { type: 'string', maxLength: 2048, pattern: '^/api/v1/' },
      },
    ],
    get: {
      summary:
        'Read catalog metadata of a managed site through this installation, with the key it holds for the site',
      responses: {
        200: {
          description: "The site's own answer, unchanged",
          content: json({ type: 'object', additionalProperties: true }),
        },
      },
    },
  },
  '/api/v1/fleet/sites/{id}/refresh': {
    parameters: [idParameter],
    post: {
      summary: 'Read a site now instead of waiting for the next background round',
      responses: {
        200: { description: 'The site after reading it', content: json(fleetSiteSchema) },
      },
    },
  },
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
              // This site's certificate with built-in HTTPS; null behind a TLS proxy.
              fingerprint: nullable(fingerprint),
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

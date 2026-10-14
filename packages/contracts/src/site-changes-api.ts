import { siteChangeErrors, siteChangeKinds } from './site-changes.js';

/** Site changes of ADR 0077 stage F3: [path, method, operationId, access, retry]. */
export const siteChangeOperations = [
  ['/system/changes', 'get', 'getSiteChanges', 'administrator', 'read'],
  ['/system/changes', 'post', 'requestSiteChange', 'administrator', 'idempotent'],
] as const;

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const text = (maxLength: number) => ({ type: 'string', maxLength });
const time = { type: 'string', format: 'date-time' };
const id = { type: 'string', format: 'uuid' };
const repository = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const node = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' };
const kind = (name: string) => ({ type: 'string', enum: [name] });
const change = {
  oneOf: [
    object(
      {
        kind: kind('mirror-attach'),
        repository,
        upstream: text(255),
        sourceRepository: repository,
        stages: {
          type: 'array',
          nullable: true,
          minItems: 1,
          maxItems: 16,
          items: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,31}$' },
        },
      },
      ['kind', 'repository', 'upstream', 'sourceRepository'],
    ),
    object({ kind: kind('mirror-key'), repository }),
    object({
      kind: kind('mirror-detach'),
      repositories: { type: 'array', minItems: 1, maxItems: 64, items: repository },
    }),
    object({ kind: kind('cluster-switchover'), node, confirm: node }),
    object({
      kind: kind('single-copy'),
      until: { ...time, nullable: true },
      reason: { type: 'string', minLength: 1, maxLength: 200 },
    }),
  ],
};
const kinds = { type: 'string', enum: siteChangeKinds };
const entry = object({
  id,
  digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  kind: kinds,
  state: { type: 'string', enum: ['pending', 'applying', 'done', 'failed'] },
  error: { type: 'string', nullable: true, enum: [...siteChangeErrors, null] },
  actor: text(200),
  requestedAt: time,
  finishedAt: { ...time, nullable: true },
});
const json = (schema: unknown) => ({ 'application/json': { schema } });

export const siteChangePaths = {
  '/api/v1/system/changes': {
    get: {
      summary: 'Read the changes queued for the site agent and how the recent ones ended',
      responses: {
        200: {
          description: 'Whether the agent runs, the pending request and the 20 newest',
          content: json(
            object({
              agent: { type: 'boolean' },
              updating: { type: 'boolean' },
              blocked: { type: 'string', nullable: true, enum: [...siteChangeErrors, null] },
              pending: {
                ...object({ id, kind: kinds, actor: text(200), requestedAt: time }),
                nullable: true,
              },
              recent: { type: 'array', maxItems: 20, items: entry },
            }),
          ),
        },
      },
    },
    post: {
      summary: 'Queue a change of mirrors or HA for the site agent; accepted does not mean applied',
      requestBody: {
        required: true,
        content: json(
          object(
            {
              id,
              change,
              key: { type: 'string', minLength: 16, maxLength: 4000, writeOnly: true },
            },
            ['id', 'change'],
          ),
        ),
      },
      responses: {
        202: { description: 'Queued, or known already by this id', content: json(object({ id })) },
      },
    },
  },
};

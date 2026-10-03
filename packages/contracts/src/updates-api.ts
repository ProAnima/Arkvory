/** System-level operations of the host updater: [path, method, operationId, access, retry]. */
export const updateOperations = [
  ['/system/updates', 'get', 'getSystemUpdates', 'administrator', 'read'],
  ['/system/updates/requests', 'post', 'requestSystemUpdate', 'administrator', 'compare-and-swap'],
] as const;
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const version = {
  type: 'string',
  pattern: '^(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})$',
};
/** Properties a client may omit and older updaters do not write (ADR 0060). */
const optional = (schema: ReturnType<typeof object>, properties: Record<string, unknown>) => ({
  ...schema,
  properties: { ...schema.properties, ...properties },
});
const integer = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const base = { id, expectedRevision: integer(2147483646) };
export const updateRequestSchema = {
  oneOf: [
    object({ ...base, kind: { type: 'string', enum: ['check'] } }),
    object({ ...base, kind: { type: 'string', enum: ['apply'] }, version, sha256: hash }),
    optional(
      object({
        ...base,
        kind: { type: 'string', enum: ['configure'] },
        automatic: { type: 'boolean' },
        hourUTC: integer(23),
      }),
      { statistics: { type: 'boolean' } },
    ),
  ],
};
const snapshot = optional(
  object({
    revision: integer(2147483646),
    currentVersion: version,
    currentSchema: integer(2147483647),
    automatic: { type: 'boolean' },
    hourUTC: integer(23),
    pin: { ...version, nullable: true },
    heartbeatAt: time,
    checkedAt: { ...time, nullable: true },
    latest: { ...object({ version, schema: integer(2147483647), sha256: hash }), nullable: true },
    phase: { type: 'string', enum: ['idle', 'checking', 'updating', 'failed'] },
    error: {
      type: 'string',
      nullable: true,
      enum: [
        'check_failed',
        'update_failed',
        'conflict',
        'maintenance_required',
        'recovery_required',
        null,
      ],
    },
    lastAttemptDay: { type: 'string', nullable: true },
    lastRequestId: { ...id, nullable: true },
  }),
  {
    statistics: { type: 'boolean' },
    channel: { type: 'string', enum: ['stable', 'beta'] },
  },
);
export const updatePaths = {
  '/api/v1/system/updates': {
    get: {
      summary: 'Read host updater heartbeat, release notification and automatic update settings',
      responses: {
        200: {
          description: 'Null when host updater is not connected',
          content: {
            'application/json': {
              schema: object({
                snapshot: { ...snapshot, nullable: true },
                pending: {
                  anyOf: [
                    ...updateRequestSchema.oneOf,
                    { type: 'object', nullable: true, enum: [null] },
                  ],
                },
              }),
            },
          },
        },
      },
    },
  },
  '/api/v1/system/updates/requests': {
    post: {
      summary: 'Queue a revision-protected update command; accepted does not mean installed',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateRequestSchema } },
      },
      responses: {
        202: {
          description: 'Queued or already acknowledged; reconcile using status and lastRequestId',
          content: { 'application/json': { schema: object({ id }) } },
        },
      },
    },
  },
};

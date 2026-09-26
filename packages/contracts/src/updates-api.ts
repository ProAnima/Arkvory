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
const integer = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const base = { id, expectedRevision: integer(2147483646) };
export const updateRequestSchema = {
  oneOf: [
    object({ ...base, kind: { type: 'string', enum: ['check'] } }),
    object({ ...base, kind: { type: 'string', enum: ['apply'] }, version, sha256: hash }),
    object({
      ...base,
      kind: { type: 'string', enum: ['configure'] },
      automatic: { type: 'boolean' },
      hourUTC: integer(23),
    }),
  ],
};
const snapshot = object({
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
});
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

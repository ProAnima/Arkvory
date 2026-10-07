import {
  MAX_BACKUP_PAGE,
  backupJobKinds,
  backupJobStateNames,
  backupRetentionMaximum,
  backupRetentionReasonNames,
  backupVerifyDepths,
  backupWarningNames,
} from './backup-wire.js';
/**
 * Operations of /api/v1/backup (ADR 0056): [path, method, operationId, system permission,
 * retry]. System permissions are never repository actions.
 */
export const backupOperations = [
  ['/backup/status', 'get', 'getBackupStatus', 'backup.read', 'read'],
  ['/backup/plan', 'get', 'getBackupPlan', 'backup.read', 'read'],
  ['/backup/plan', 'put', 'updateBackupPlan', 'backup.manage', 'compare-and-swap'],
  ['/backup/runs', 'post', 'requestBackupRun', 'backup.manage', 'idempotency-key'],
  ['/backup/jobs', 'get', 'listBackupJobs', 'backup.read', 'read'],
  ['/backup/points', 'get', 'listBackupPoints', 'backup.read', 'read'],
  ['/backup/points/{id}/verify', 'post', 'requestBackupVerify', 'backup.manage', 'idempotency-key'],
  ['/backup/points/{id}/pin', 'put', 'setBackupPointPin', 'backup.manage', 'idempotent'],
  ['/backup/retention/preview', 'get', 'previewBackupRetention', 'backup.read', 'read'],
  ['/backup/retention/apply', 'post', 'requestBackupRetention', 'backup.manage', 'idempotency-key'],
] as const;

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const nullable = (schema: Record<string, unknown>) => ({ ...schema, nullable: true });
const int = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
const count = { type: 'integer', minimum: 0 };
const uuid = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const bytes = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' };
const machine = { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' };
const retention = object({
  daily: int(backupRetentionMaximum.daily),
  weekly: int(backupRetentionMaximum.weekly),
  monthly: int(backupRetentionMaximum.monthly),
});
const schedule = {
  enabled: { type: 'boolean' },
  hour: int(23),
  minute: int(59),
  timezone: {
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description: 'Explicit IANA time zone, e.g. Europe/Moscow; validated by the server.',
  },
  retention,
};
export const backupPlanSchema = object({ ...schedule, revision: int(2147483647) });
const planUpdate = object({ expectedRevision: int(2147483647), ...schedule });
export const backupPointSchema = object({
  id: uuid,
  snapshotAt: { ...time, description: 'Snapshot time T; the age of a point counts from T.' },
  completedAt: time,
  blobs: count,
  contentBytes: bytes,
  newBytes: { ...bytes, description: 'Bytes this point added to the vault.' },
  tables: count,
  rows: count,
  pinned: { type: 'boolean' },
  verifiedAt: nullable(time),
  verifyDepth: { type: 'string', enum: [...backupVerifyDepths, null], nullable: true },
  verifyError: nullable(machine),
});
export const backupJobSchema = object({
  id: uuid,
  kind: { type: 'string', enum: backupJobKinds },
  state: { type: 'string', enum: backupJobStateNames },
  phase: nullable(machine),
  startedAt: { ...time, description: 'Start of execution, or the request time while queued.' },
  finishedAt: nullable(time),
  errorCode: nullable(machine),
  pointId: nullable(uuid),
  progress: object({
    bytesCopied: { ...bytes, description: 'Processed bytes: copied or already in the vault.' },
    bytesTotal: bytes,
    blobsCopied: count,
    blobsTotal: count,
  }),
});
const cursor = { type: 'string', pattern: '^[0-9]{1,17}_[0-9a-f-]{36}$' };
const page = (item: unknown) =>
  object({
    items: { type: 'array', maxItems: MAX_BACKUP_PAGE, items: item },
    next: nullable(cursor),
  });
const receipt = object({
  id: uuid,
  kind: { type: 'string', enum: backupJobKinds },
  state: { type: 'string', enum: backupJobStateNames },
});
const status = object({
  vault: object({
    configured: { type: 'boolean' },
    id: nullable(uuid),
    available: { type: 'boolean' },
    encrypted: nullable({
      type: 'boolean',
      description: 'Vault is encrypted (ADR 0070); null when unknown or not connected.',
    }),
    freeBytes: nullable(bytes),
    totalBytes: nullable(bytes),
  }),
  agent: object({
    online: { type: 'boolean' },
    lastSeenAt: nullable(time),
    version: nullable({ type: 'string', maxLength: 64 }),
  }),
  plan: backupPlanSchema,
  lastCompleted: nullable(backupPointSchema),
  nextRunAt: nullable(time),
  running: nullable(backupJobSchema),
  warnings: {
    type: 'array',
    maxItems: backupWarningNames.length,
    items: object({
      code: { type: 'string', enum: backupWarningNames },
      severity: { type: 'string', enum: ['warning', 'critical'] },
    }),
  },
});
const preview = object({
  keep: {
    type: 'array',
    items: object({
      id: uuid,
      reasons: { type: 'array', items: { type: 'string', enum: backupRetentionReasonNames } },
    }),
  },
  delete: { type: 'array', items: object({ id: uuid }) },
});

const json = (description: string, schema: unknown) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } });
const idempotencyKey = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' },
  description: 'Repeat returns the same job; per caller and operation kind.',
};
const pointId = { name: 'id', in: 'path', required: true, schema: uuid };
const pageParameters = [
  { name: 'after', in: 'query', schema: cursor, description: 'next of the previous page' },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: MAX_BACKUP_PAGE, default: 50 },
  },
];
const queued = (summary: string, parameters: readonly unknown[] = []) => ({
  summary,
  parameters: [idempotencyKey, ...parameters],
  responses: {
    '202': json('Queued for the backup agent, or the job of a repeated key.', receipt),
  },
});

export const backupPaths = {
  '/api/v1/backup/status': {
    get: {
      summary: 'Vault, agent, plan, newest point, next run, running job and warnings',
      responses: { '200': json('Backup status; no paths or secrets.', status) },
    },
  },
  '/api/v1/backup/plan': {
    get: {
      summary: 'Read the daily schedule and retention policy',
      responses: { '200': json('Plan with its CAS revision.', backupPlanSchema) },
    },
    put: {
      summary: 'Replace the plan; 409 revision_mismatch when it changed meanwhile',
      requestBody: body(planUpdate),
      responses: { '200': json('Saved plan.', backupPlanSchema) },
    },
  },
  '/api/v1/backup/runs': {
    post: queued('Queue a capture now; the agent runs it and then verification and retention'),
  },
  '/api/v1/backup/jobs': {
    get: {
      summary: 'Backup jobs, newest first',
      parameters: pageParameters,
      responses: {
        '200': json('Page; pass next as after, null marks the end.', page(backupJobSchema)),
      },
    },
  },
  '/api/v1/backup/points': {
    get: {
      summary: 'Completed restore points of the current vault, newest snapshot first',
      parameters: pageParameters,
      responses: { '200': json('Page; pass next as after.', page(backupPointSchema)) },
    },
  },
  '/api/v1/backup/points/{id}/verify': {
    parameters: [pointId],
    post: queued('Queue a deep verification that reads every byte of the point'),
  },
  '/api/v1/backup/points/{id}/pin': {
    parameters: [pointId],
    put: {
      summary: 'Pin or unpin a point; pinned points are kept beyond the retention policy',
      requestBody: body(object({ pinned: { type: 'boolean' } })),
      responses: { '200': json('Updated point.', backupPointSchema) },
    },
  },
  '/api/v1/backup/retention/preview': {
    get: {
      summary: 'Points the retention policy keeps (with reasons) and deletes now',
      responses: { '200': json('Advisory: apply decides again from the vault.', preview) },
    },
  },
  '/api/v1/backup/retention/apply': {
    post: queued('Queue retention: forget points outside the policy, then prune unused content'),
  },
};

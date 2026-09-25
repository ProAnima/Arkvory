import { record, integer, text } from './wire-values.js';

const bounded = (value: unknown, min: number, max: number) => {
  const n = integer(value);
  if (n < min || n > max) throw new Error('Invalid cleanup number');
  return n;
};
export function readCleanupPolicy(value: unknown) {
  const r = record(value);
  if (typeof r['enabled'] !== 'boolean') throw new Error('Invalid cleanup switch');
  return {
    enabled: r['enabled'],
    graceHours: bounded(r['graceHours'], 0, 8760),
    batchSize: bounded(r['batchSize'], 1, 100),
    intervalSeconds: bounded(r['intervalSeconds'], 5, 86400),
    delayMilliseconds: bounded(r['delayMilliseconds'], 0, 1000),
  };
}
export type CleanupPolicyRequest = ReturnType<typeof readCleanupPolicy>;
export function readCleanupSnapshot(value: unknown) {
  const r = record(value);
  const date = (v: unknown) => {
    if (v === null) return null;
    const s = text(v);
    if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
      throw new Error('Invalid cleanup date');
    return s;
  };
  const bytes = text(r['lastReclaimedBytes']);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(bytes)) throw new Error('Invalid cleanup bytes');
  const error = r['lastError'] === null ? null : text(r['lastError']);
  if (error !== null && !/^[a-z_]{1,64}$/.test(error)) throw new Error('Invalid cleanup error');
  return {
    revision: bounded(r['revision'], 0, 2147483647),
    policy: readCleanupPolicy(r['policy']),
    lastRunAt: date(r['lastRunAt']),
    nextRunAt: date(r['nextRunAt']),
    lastCollected: bounded(r['lastCollected'], 0, 100),
    lastDeferred: bounded(r['lastDeferred'], 0, 100),
    lastFailed: bounded(r['lastFailed'], 0, 100),
    lastReclaimedBytes: bytes,
    lastError: error,
  };
}
const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const policy = object({
  enabled: { type: 'boolean' },
  graceHours: int(0, 8760),
  batchSize: int(1, 100),
  intervalSeconds: int(5, 86400),
  delayMilliseconds: int(0, 1000),
});
const time = { type: 'string', format: 'date-time', nullable: true };
const snapshot = object({
  revision: int(0, 2147483647),
  policy,
  lastRunAt: time,
  nextRunAt: time,
  lastCollected: int(0, 100),
  lastDeferred: int(0, 100),
  lastFailed: int(0, 100),
  lastReclaimedBytes: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
  lastError: { type: 'string', nullable: true },
});
const responses = {
  200: {
    description:
      'Cleanup configuration and last completed batch; requesting a run does not mean bytes are already removed',
    content: { 'application/json': { schema: snapshot } },
  },
};
const body = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } });
const parameters = [
  {
    name: 'repository',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  },
];
const root = '/api/v1/repositories/{repository}/storage/cleanup';
export const cleanupPaths = {
  [root]: {
    parameters,
    get: { summary: 'Read online cleanup policy and progress', responses },
    put: {
      summary: 'Configure or pause online cleanup without restarting; revision protected',
      requestBody: body(object({ expectedRevision: int(0, 2147483647), policy })),
      responses,
    },
  },
  [root + '/run']: {
    parameters,
    post: {
      summary: 'Schedule one enabled cleanup batch; existing readers and writers are deferred',
      requestBody: body(object({ expectedRevision: int(0, 2147483647) })),
      responses,
    },
  },
};

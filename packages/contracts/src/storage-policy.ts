import { record, text, integer, items } from './wire-values.js';
import { readDeletionCandidate, readDeletionResult } from './retention.js';

const groups = ['package-channel', 'package', 'repository'] as const;
const states = ['unlimited', 'normal', 'warning', 'critical', 'exceeded'] as const;
const levels = ['info', 'warning', 'error'] as const;
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  const selected = options.find((v) => v === value);
  if (!selected) throw new Error('Invalid storage enum');
  return selected;
}
function bounded(value: unknown, min: number, max: number) {
  const n = integer(value);
  if (n < min || n > max) throw new Error('Invalid storage integer');
  return n;
}
function bytes(value: unknown) {
  const s = text(value);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(s) || BigInt(s) > 9223372036854775807n)
    throw new Error('Invalid storage bytes');
  return s;
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid storage boolean');
  return value;
}
function date(value: unknown) {
  const s = text(value);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
    throw new Error('Invalid storage timestamp');
  return s;
}
function label(value: unknown) {
  const s = text(value);
  if (!/^[\p{L}\p{N}_.:-]{1,64}$/u.test(s)) throw new Error('Invalid policy label');
  return s;
}
function boundedItems(value: unknown, max: number) {
  const v = items(value);
  if (v.length > max) throw new Error('Too many storage items');
  return v;
}
export function readStoragePolicy(value: unknown) {
  const r = record(value),
    channels = boundedItems(r['channels'], 32).map((value) => {
      const c = record(value);
      return { label: label(c['label']), keepLast: bounded(c['keepLast'], 1, 100000) };
    }),
    protectedLabels = boundedItems(r['protectedLabels'], 32).map(label);
  if (
    new Set(channels.map((c) => c.label)).size !== channels.length ||
    new Set(protectedLabels).size !== protectedLabels.length
  )
    throw new Error('Duplicate policy labels');
  const warningPercent = bounded(r['warningPercent'], 1, 98),
    criticalPercent = bounded(r['criticalPercent'], 2, 99);
  if (warningPercent >= criticalPercent) throw new Error('Invalid capacity thresholds');
  const quotaBytes = r['quotaBytes'] === null ? null : bytes(r['quotaBytes']);
  if (quotaBytes !== null && (BigInt(quotaBytes) < 1n || BigInt(quotaBytes) > 9007199254740991n))
    throw new Error('Invalid quota');
  return {
    enabled: bool(r['enabled']),
    grouping: choice(r['grouping'], groups),
    keepLast: bounded(r['keepLast'], 1, 100000),
    channels,
    protectedLabels,
    minAgeHours: bounded(r['minAgeHours'], 0, 87600),
    intervalMinutes: bounded(r['intervalMinutes'], 1, 10080),
    quotaBytes,
    warningPercent,
    criticalPercent,
  };
}
export type StoragePolicyRequest = ReturnType<typeof readStoragePolicy>;
export function readStoragePolicySnapshot(value: unknown) {
  const r = record(value),
    lastError = r['lastError'] === null ? null : text(r['lastError']);
  if (lastError !== null && !/^[a-z_]{1,64}$/.test(lastError))
    throw new Error('Invalid storage error');
  return {
    revision: bounded(r['revision'], 0, 2147483647),
    policy: readStoragePolicy(r['policy']),
    nextRunAt: r['nextRunAt'] === null ? null : date(r['nextRunAt']),
    lastRunAt: r['lastRunAt'] === null ? null : date(r['lastRunAt']),
    lastDeleted: bounded(r['lastDeleted'], 0, 100),
    lastError,
  };
}
export function readStorageUsage(value: unknown) {
  const r = record(value),
    result = {
      publishedBytes: bytes(r['publishedBytes']),
      pendingBytes: bytes(r['pendingBytes']),
      retiredBytes: bytes(r['retiredBytes']),
      reservedBytes: bytes(r['reservedBytes']),
      quotaBytes: r['quotaBytes'] === null ? null : bytes(r['quotaBytes']),
      state: choice(r['state'], states),
    };
  if (
    BigInt(result.publishedBytes) + BigInt(result.pendingBytes) + BigInt(result.retiredBytes) !==
    BigInt(result.reservedBytes)
  )
    throw new Error('Inconsistent storage usage');
  return result;
}
export function readStoragePreview(value: unknown) {
  const r = record(value);
  return {
    revision: bounded(r['revision'], 0, 2147483647),
    items: boundedItems(r['items'], 100).map(readDeletionCandidate),
    hasMore: bool(r['hasMore']),
  };
}
export function readStorageRun(value: unknown) {
  return { items: boundedItems(record(value)['items'], 100).map(readDeletionResult) };
}
export function readStorageEvents(value: unknown) {
  const r = record(value),
    entries = boundedItems(r['items'], 100).map((v) => {
      const e = record(v),
        details = record(e['details']),
        safe: Record<string, string | number> = {};
      if (Object.keys(details).length > 16) throw new Error('Too many diagnostic fields');
      for (const [k, v] of Object.entries(details)) {
        if (
          k.length > 64 ||
          (typeof v !== 'string' && typeof v !== 'number') ||
          (typeof v === 'string' && v.length > 256) ||
          (typeof v === 'number' && !Number.isSafeInteger(v))
        )
          throw new Error('Invalid diagnostic field');
        safe[k] = v;
      }
      const code = text(e['code']);
      if (!/^[a-z0-9_.]{1,96}$/.test(code)) throw new Error('Invalid diagnostic code');
      return {
        sequence: bytes(e['sequence']),
        occurredAt: date(e['occurredAt']),
        level: choice(e['level'], levels),
        code,
        details: safe,
      };
    });
  const next = r['next'] === null ? null : bytes(r['next']);
  if (
    entries.some(
      (e, i) =>
        BigInt(e.sequence) < 1n ||
        (i > 0 && BigInt(e.sequence) <= BigInt(entries[i - 1]?.sequence ?? '0')),
    ) ||
    (next !== null && next !== entries.at(-1)?.sequence)
  )
    throw new Error('Invalid event cursor');
  return { items: entries, next };
}

const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' };
const time = { type: 'string', format: 'date-time', nullable: true };
const labelSchema = { type: 'string', minLength: 1, maxLength: 64 };
export const storagePolicySchema = object({
  enabled: { type: 'boolean' },
  grouping: { type: 'string', enum: groups },
  keepLast: int(1, 100000),
  channels: {
    type: 'array',
    maxItems: 32,
    items: object({ label: labelSchema, keepLast: int(1, 100000) }),
  },
  protectedLabels: { type: 'array', maxItems: 32, uniqueItems: true, items: labelSchema },
  minAgeHours: int(0, 87600),
  intervalMinutes: int(1, 10080),
  quotaBytes: { type: 'string', pattern: '^[1-9][0-9]{0,15}$', nullable: true },
  warningPercent: int(1, 98),
  criticalPercent: int(2, 99),
});
const snapshotSchema = object({
  revision: int(0, 2147483647),
  policy: storagePolicySchema,
  nextRunAt: time,
  lastRunAt: time,
  lastDeleted: int(0, 100),
  lastError: { type: 'string', nullable: true, maxLength: 64 },
});
const usageSchema = object({
  publishedBytes: decimal,
  pendingBytes: decimal,
  retiredBytes: decimal,
  reservedBytes: decimal,
  quotaBytes: { ...decimal, nullable: true },
  state: { type: 'string', enum: states },
});
const candidateSchema = object({
  id: { type: 'string', format: 'uuid' },
  name: { type: 'string', maxLength: 240 },
  size: decimal,
  publishedAt: { type: 'string', format: 'date-time' },
  annotationRevision: int(0, 2147483647),
  blockers: { type: 'array', maxItems: 0, items: { type: 'string' } },
});
const runSchema = object({
  items: {
    type: 'array',
    maxItems: 100,
    items: object({
      id: { type: 'string', format: 'uuid' },
      outcome: {
        type: 'string',
        enum: ['deleted', 'already_deleted', 'protected', 'changed', 'not_eligible', 'not_found'],
      },
      blockers: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'string',
          enum: [
            'reference',
            'asset_history',
            'attachment_history',
            'protected_label',
            'promotion_stage',
          ],
        },
      },
    }),
  },
});
const eventsSchema = object({
  items: {
    type: 'array',
    maxItems: 100,
    items: object({
      sequence: decimal,
      occurredAt: { type: 'string', format: 'date-time' },
      level: { type: 'string', enum: levels },
      code: { type: 'string', maxLength: 96 },
      details: {
        type: 'object',
        maxProperties: 16,
        additionalProperties: { oneOf: [{ type: 'string', maxLength: 256 }, { type: 'integer' }] },
      },
    }),
  },
  next: { ...decimal, nullable: true },
});
const json = (schema: unknown) => ({ 'application/json': { schema } });
const response = (schema: unknown) => ({
  200: { description: 'Repository storage result', content: json(schema) },
});
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const parameters = [
  {
    name: 'repository',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  },
];
const root = '/api/v1/repositories/{repository}/storage';
export const storagePolicyPaths = {
  [root + '/policy']: {
    parameters,
    get: {
      summary: 'Read retention and quota policy; defaults are disabled',
      responses: response(snapshotSchema),
    },
    put: {
      summary:
        'Replace policy with revision check; enabling also requires artifact.delete and binds scheduling to this live key',
      requestBody: body(
        object({ expectedRevision: int(0, 2147483647), policy: storagePolicySchema }),
      ),
      responses: response(snapshotSchema),
    },
  },
  [root + '/usage']: {
    parameters,
    get: {
      summary: 'Logical reservations including pending and retired bytes; not physical disk usage',
      responses: response(usageSchema),
    },
  },
  [root + '/preview']: {
    parameters,
    get: {
      summary:
        'Preview up to 100 unprotected registered builds beyond last N; no snapshot reservation',
      responses: response(
        object({
          revision: int(0, 2147483647),
          items: { type: 'array', maxItems: 100, items: candidateSchema },
          hasMore: { type: 'boolean' },
        }),
      ),
    },
  },
  [root + '/run']: {
    parameters,
    post: {
      summary:
        'Execute one bounded batch of the enabled policy; rechecks rank, authority and references; physical GC follows the independent online cleanup policy',
      requestBody: body(object({ expectedRevision: int(0, 2147483647) })),
      responses: response(runSchema),
    },
  },
  [root + '/events']: {
    parameters,
    get: {
      summary:
        'Bounded diagnostic history; at most 1000 per repository and 20000 globally, export for long-term retention',
      parameters: [
        { name: 'after', in: 'query', schema: decimal },
        { name: 'level', in: 'query', schema: { type: 'string', enum: levels } },
      ],
      responses: response(eventsSchema),
    },
  },
};

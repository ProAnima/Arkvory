import { record, text, integer, items } from './wire-values.js';

export interface RetentionCriteriaRequest {
  publishedBefore: string;
  protectedLabels: readonly string[];
}
export interface DeletionSelectionRequest {
  id: string;
  expectedAnnotationRevision: number;
}
export interface RetentionPreviewRequest {
  criteria: RetentionCriteriaRequest;
  limit?: number;
  after?: string;
}
export interface RetentionApplyRequest {
  criteria: RetentionCriteriaRequest;
  items: readonly DeletionSelectionRequest[];
}
export const deletionBlockers = [
  'reference',
  'asset_history',
  'attachment_history',
  'protected_label',
] as const;
export const deletionOutcomes = [
  'deleted',
  'already_deleted',
  'protected',
  'changed',
  'not_eligible',
  'not_found',
] as const;
function id(value: unknown) {
  const result = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result))
    throw new Error('Invalid artifact ID');
  return result;
}
function blockers(value: unknown) {
  const result = items(value).map((entry) => {
    const found = deletionBlockers.find((name) => name === entry);
    if (!found) throw new Error('Invalid deletion blocker');
    return found;
  });
  if (result.length > 4 || new Set(result).size !== result.length)
    throw new Error('Invalid deletion blockers');
  return result;
}
export function readDeletionCandidate(value: unknown) {
  const r = record(value),
    size = text(r['size']),
    publishedAt = text(r['publishedAt']),
    name = text(r['name']),
    revision = integer(r['annotationRevision']);
  if (
    !/^(0|[1-9][0-9]{0,15})$/.test(size) ||
    Number(size) > 68719476736 ||
    !name ||
    name.length > 240 ||
    revision > 2147483647 ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    new Date(publishedAt).toISOString() !== publishedAt
  )
    throw new Error('Invalid deletion candidate');
  return {
    id: id(r['id']),
    name,
    size,
    publishedAt,
    annotationRevision: revision,
    blockers: blockers(r['blockers']),
  };
}
export function readRetentionPreview(value: unknown) {
  const r = record(value),
    entries = items(r['items']);
  if (entries.length > 100) throw new Error('Invalid retention page');
  const checked = entries.map(readDeletionCandidate),
    next = r['next'] === null ? null : id(r['next']);
  if (
    checked.some((row, index) => index > 0 && row.id <= (checked[index - 1]?.id ?? '')) ||
    (next !== null && next !== checked.at(-1)?.id)
  )
    throw new Error('Invalid retention cursor');
  return { items: checked, next };
}
export function readDeletionResult(value: unknown) {
  const r = record(value),
    outcome = deletionOutcomes.find((entry) => entry === r['outcome']);
  if (!outcome) throw new Error('Invalid deletion outcome');
  const reasons = blockers(r['blockers']);
  if ((outcome === 'protected') !== reasons.length > 0)
    throw new Error('Invalid deletion outcome blockers');
  return { id: id(r['id']), outcome, blockers: reasons };
}
export function readRetentionResult(value: unknown) {
  const entries = items(record(value)['items']);
  if (!entries.length || entries.length > 100) throw new Error('Invalid retention result');
  const checked = entries.map(readDeletionResult);
  if (new Set(checked.map((entry) => entry.id)).size !== checked.length)
    throw new Error('Duplicate deletion result');
  return { items: checked };
}
export type DeletionCandidateResponse = ReturnType<typeof readDeletionCandidate>;
export type DeletionResultResponse = ReturnType<typeof readDeletionResult>;

const uuid = { type: 'string', format: 'uuid' };
const revision = { type: 'integer', minimum: 0, maximum: 2147483647 };
const reasons = {
  type: 'array',
  maxItems: 4,
  uniqueItems: true,
  items: { type: 'string', enum: deletionBlockers },
};
const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'size', 'publishedAt', 'annotationRevision', 'blockers'],
  properties: {
    id: uuid,
    name: { type: 'string', minLength: 1, maxLength: 240 },
    size: { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})$' },
    publishedAt: { type: 'string', format: 'date-time' },
    annotationRevision: revision,
    blockers: reasons,
  },
};
const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'outcome', 'blockers'],
  properties: { id: uuid, outcome: { type: 'string', enum: deletionOutcomes }, blockers: reasons },
};
const criteriaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['publishedBefore', 'protectedLabels'],
  properties: {
    publishedBefore: {
      type: 'string',
      format: 'date-time',
      pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$',
    },
    protectedLabels: {
      type: 'array',
      maxItems: 32,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};
const json = (schema: unknown) => ({ 'application/json': { schema } });
const response = (schema: unknown) => ({
  200: {
    description: 'Inspected outcome; protected/changed objects are not deleted',
    content: json(schema),
  },
});
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const repositoryParameter = {
  name: 'repository',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
};
const root = '/api/v1/repositories/{repository}';
export const deletionOperation = {
  summary:
    'Logically delete an unreferenced published artifact with annotation concurrency check; explicit managed permission required',
  requestBody: body({
    type: 'object',
    additionalProperties: false,
    required: ['expectedAnnotationRevision'],
    properties: { expectedAnnotationRevision: revision },
  }),
  responses: response(resultSchema),
};
export const retentionPaths = {
  [root + '/artifacts/{id}/deletion']: {
    parameters: [repositoryParameter, { name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      summary: 'Inspect deletion dependencies without modifying content',
      responses: response(candidateSchema),
    },
  },
  [root + '/retention/preview']: {
    parameters: [repositoryParameter],
    post: {
      summary: 'Preview bounded retention candidates and blockers; no snapshot reservation',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['criteria'],
        properties: {
          criteria: criteriaSchema,
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          after: uuid,
        },
      }),
      responses: response({
        type: 'object',
        additionalProperties: false,
        required: ['items', 'next'],
        properties: {
          items: { type: 'array', maxItems: 100, items: candidateSchema },
          next: { ...uuid, nullable: true },
        },
      }),
    },
  },
  [root + '/retention/apply']: {
    parameters: [repositoryParameter],
    post: {
      summary:
        'Recheck and logically delete only explicitly selected retention candidates in one transaction; bytes reclaimed offline',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['criteria', 'items'],
        properties: {
          criteria: criteriaSchema,
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'expectedAnnotationRevision'],
              properties: { id: uuid, expectedAnnotationRevision: revision },
            },
          },
        },
      }),
      responses: response({
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: { items: { type: 'array', minItems: 1, maxItems: 100, items: resultSchema } },
      }),
    },
  },
};

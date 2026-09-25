import { record, integer, text, items } from './wire-values.js';

export const buildAttachmentKinds = ['manifest', 'sbom', 'signature', 'report', 'file'] as const;
export interface BuildAttachmentResponse {
  name: string;
  kind: (typeof buildAttachmentKinds)[number];
  artifactId: string;
  description: string;
}
export interface AttachmentRevisionResponse {
  revision: number;
  items: readonly BuildAttachmentResponse[];
  actor: string | null;
  createdAt: string | null;
}
export interface AttachmentHistoryResponse {
  items: readonly AttachmentRevisionResponse[];
  next: number | null;
}
export function readAttachmentRevision(value: unknown): AttachmentRevisionResponse {
  const r = record(value),
    revision = integer(r['revision']);
  const entries = items(r['items']);
  if (revision > 2147483647 || entries.length > 32) throw new Error('Invalid attachments');
  const names = new Set<string>();
  const checked = entries.map((entry): BuildAttachmentResponse => {
    const row = record(entry),
      name = text(row['name']),
      artifactId = text(row['artifactId']),
      description = text(row['description']),
      kind = row['kind'];
    if (
      kind !== 'manifest' &&
      kind !== 'sbom' &&
      kind !== 'signature' &&
      kind !== 'report' &&
      kind !== 'file'
    )
      throw new Error('Invalid attachment kind');
    if (
      !name ||
      name.length > 240 ||
      name.trim() !== name ||
      name.includes('/') ||
      name.includes('\\') ||
      Array.from(name).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      name === '.' ||
      name === '..' ||
      names.has(name.toLowerCase()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(artifactId) ||
      description.length > 512 ||
      description.includes('\u0000')
    )
      throw new Error('Invalid attachment');
    names.add(name.toLowerCase());
    return { name, kind, artifactId, description };
  });
  const actor = r['actor'] === null ? null : text(r['actor']);
  const createdAt = r['createdAt'] === null ? null : text(r['createdAt']);
  if (
    revision === 0
      ? checked.length !== 0 || actor !== null || createdAt !== null
      : !actor || !createdAt || !Number.isFinite(Date.parse(createdAt))
  )
    throw new Error('Invalid attachment revision');
  return { revision, items: checked, actor, createdAt };
}
export function readAttachmentHistory(value: unknown): AttachmentHistoryResponse {
  const row = record(value),
    entries = items(row['items']);
  if (entries.length > 20) throw new Error('Invalid attachment history size');
  const checked = entries.map(readAttachmentRevision);
  if (
    checked.some(
      (r, i) => r.revision === 0 || (i > 0 && r.revision >= (checked[i - 1]?.revision ?? 0)),
    )
  )
    throw new Error('Invalid attachment history order');
  const next = row['next'] === null ? null : integer(row['next']);
  if (next !== null && (next < 1 || checked.length !== 20 || next !== checked.at(-1)?.revision))
    throw new Error('Invalid attachment history cursor');
  return { items: checked, next };
}

const attachmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'kind', 'artifactId', 'description'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 240 },
    kind: { type: 'string', enum: buildAttachmentKinds },
    artifactId: { type: 'string', format: 'uuid' },
    description: { type: 'string', maxLength: 512 },
  },
};
const revisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['revision', 'items', 'actor', 'createdAt'],
  properties: {
    revision: { type: 'integer', minimum: 0, maximum: 2147483647 },
    items: { type: 'array', maxItems: 32, items: attachmentSchema },
    actor: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
const response = (schema: unknown) => ({
  200: { description: 'Success', content: { 'application/json': { schema } } },
});
const root = '/api/v1/repositories/{repository}/artifacts/{id}/attachments';
const parameters = [
  {
    name: 'repository',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  },
  { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
];
export const attachmentPaths = {
  [root]: {
    parameters,
    get: {
      summary: 'Read the current build attachment revision',
      responses: response(revisionSchema),
    },
    put: {
      summary:
        'Replace build attachments using optimistic concurrency; targets must be published in the same repository',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['expectedRevision', 'items'],
              properties: {
                expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 },
                items: { type: 'array', maxItems: 32, items: attachmentSchema },
              },
            },
          },
        },
      },
      responses: response(revisionSchema),
    },
  },
  [`${root}/history`]: {
    parameters,
    get: {
      summary: 'Read attachment history, newest first; immutable file references are retained',
      parameters: [
        {
          name: 'before',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
        },
      ],
      responses: response({
        type: 'object',
        additionalProperties: false,
        required: ['items', 'next'],
        properties: {
          items: { type: 'array', maxItems: 20, items: revisionSchema },
          next: { type: 'integer', minimum: 1, maximum: 2147483647, nullable: true },
        },
      }),
    },
  },
};

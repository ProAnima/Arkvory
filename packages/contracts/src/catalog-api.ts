const str = { type: 'string' } as const;
const revision = { type: 'integer', minimum: 0, maximum: 2147483646 } as const;
const annotation = {
  type: 'object',
  required: ['revision', 'labels', 'metadata', 'collections'],
  properties: {
    revision,
    labels: { type: 'array', maxItems: 32, items: str },
    metadata: { type: 'object', maxProperties: 32, additionalProperties: str },
    collections: { type: 'array', maxItems: 32, items: str },
  },
};
const part = {
  type: 'object',
  required: ['index', 'size', 'sha256'],
  properties: {
    index: { type: 'integer', minimum: 0, maximum: 639 },
    size: { type: 'integer', minimum: 1, maximum: 8388608 },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
};
const job = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    uploadId: { type: 'string', format: 'uuid' },
    repository: str,
    owner: str,
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
    generation: revision,
    attempts: { type: 'integer' },
    errorCode: { type: 'string', nullable: true },
  },
};
const asset = {
  type: 'object',
  properties: { path: str, revision, artifactId: { type: 'string', format: 'uuid' } },
};
const pkg = {
  type: 'object',
  properties: {
    group: str,
    name: str,
    version: str,
    artifactId: { type: 'string', format: 'uuid' },
    manifest: { type: 'object', additionalProperties: true },
  },
};
const page = (schema: unknown) => ({
  type: 'object',
  properties: { items: { type: 'array', items: schema } },
});
const request = (schema: unknown) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const response = (schema: unknown) => ({
  description: 'Success',
  content: { 'application/json': { schema } },
});
const error = {
  description:
    'Native error object: code, message, requestId. 400 invalid input; 403 scope denied; 404 absent; 409 conflict; 422 integrity mismatch; 503 Retry-After; 507 capacity.',
};
const operation = (summary: string, schema: unknown, extra: Record<string, unknown> = {}) => ({
  summary,
  responses: { 200: response(schema), default: error },
  ...extra,
});
const query = (name: string) => ({ name, in: 'query', schema: str });
const root = '/api/v1/repositories/{repository}';
const paths: Record<string, Record<string, unknown>> = {
  [`${root}/uploads/{id}/parts`]: {
    get: operation('Recorded parts; fixed 8 MiB except last', {
      type: 'object',
      properties: {
        partBytes: { type: 'integer', enum: [8388608] },
        items: { type: 'array', items: part },
      },
    }),
  },
  [`${root}/uploads/{id}/parts/{index}`]: {
    put: {
      summary: 'Idempotent immutable part upload',
      parameters: [
        {
          name: 'X-Content-SHA256',
          in: 'header',
          required: true,
          schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
      ],
      requestBody: {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      responses: { 204: { description: 'Part persisted' }, default: error },
    },
  },
  [`${root}/uploads/{id}/complete-async`]: {
    post: {
      summary: 'Enqueue idempotent completion; requires worker',
      responses: { 202: response(job), default: error },
    },
  },
  '/api/v1/jobs/{id}': { get: operation('Own completion job', job) },
  [`${root}/artifacts/{id}/annotations`]: {
    get: operation('Current annotations; revision 0 uses original descriptor', annotation),
    put: operation('Replace annotations using optimistic revision', annotation, {
      requestBody: request({
        type: 'object',
        required: ['expectedRevision', 'value'],
        properties: {
          expectedRevision: revision,
          value: {
            type: 'object',
            additionalProperties: false,
            properties: {
              labels: annotation.properties.labels,
              metadata: annotation.properties.metadata,
              collections: annotation.properties.collections,
            },
          },
        },
      }),
    }),
  },
  [`${root}/artifacts/{id}/package`]: {
    post: operation('Validate and register immutable UPack identity', pkg),
  },
  [`${root}/packages`]: {
    get: operation('SemVer ordered versions; narrow filter above 1000 results', page(pkg), {
      parameters: [query('group'), query('name')],
    }),
  },
  [`${root}/assets`]: {
    get: operation('Asset paths by prefix; narrow above 1000 results', page(asset), {
      parameters: [query('prefix')],
    }),
  },
  [`${root}/asset`]: {
    get: operation('Resolve latest asset revision', asset, {
      parameters: [{ ...query('path'), required: true }],
    }),
    put: operation('Create (revision 0) or replace asset pointer; retain history', asset, {
      requestBody: request({
        type: 'object',
        required: ['path', 'artifactId', 'expectedRevision'],
        properties: {
          path: str,
          artifactId: { type: 'string', format: 'uuid' },
          expectedRevision: revision,
        },
      }),
    }),
  },
  [`${root}/search`]: {
    get: operation(
      'Search names, exact label and collection; pages of 100',
      {
        ...page({
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' }, name: str },
        }),
        properties: {
          ...page({ type: 'object', properties: { id: str, name: str } }).properties,
          next: { type: 'string', nullable: true },
        },
      },
      { parameters: ['q', 'label', 'collection', 'after'].map(query) },
    ),
  },
  [`${root}/audit`]: {
    get: operation(
      'Audit of catalog mutations, write scope; pages of 100',
      page({
        type: 'object',
        properties: {
          sequence: str,
          actor: str,
          action: str,
          artifactId: str,
          occurredAt: { type: 'string', format: 'date-time' },
        },
      }),
      { parameters: [query('after')] },
    ),
  },
  [`${root}/artifacts/{id}/references`]: Object.fromEntries(
    ['post', 'delete'].map((method) => [
      method,
      {
        summary: method === 'post' ? 'Add own external reference' : 'Remove own external reference',
        requestBody: request({
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string', maxLength: 256 } },
        }),
        responses: { 204: { description: 'Reference updated' }, default: error },
      },
    ]),
  ),
};
for (const [path, item] of Object.entries(paths))
  item['parameters'] = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: match[1] === 'index' ? { type: 'integer', minimum: 0, maximum: 639 } : str,
  }));
export const catalogPaths = paths;

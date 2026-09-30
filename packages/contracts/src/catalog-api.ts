const str = { type: 'string' } as const;
const revision = { type: 'integer', minimum: 0, maximum: 2147483646 } as const;
const storedRevision = { type: 'integer', minimum: 1, maximum: 2147483647 } as const;
const annotation = {
  type: 'object',
  required: ['revision', 'labels', 'metadata', 'collections'],
  properties: {
    revision: { ...storedRevision, minimum: 0 },
    labels: { type: 'array', maxItems: 32, items: str },
    metadata: { type: 'object', maxProperties: 32, additionalProperties: str },
    collections: { type: 'array', maxItems: 32, items: str },
  },
};
const part = {
  type: 'object',
  required: ['index', 'size', 'sha256'],
  properties: {
    index: { type: 'integer', minimum: 0, maximum: 9999 },
    size: { type: 'integer', minimum: 1, maximum: 8388608 },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
};
const job = {
  type: 'object',
  required: [
    'id',
    'uploadId',
    'repository',
    'owner',
    'status',
    'generation',
    'attempts',
    'errorCode',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    uploadId: { type: 'string', format: 'uuid' },
    repository: str,
    owner: str,
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
    generation: { type: 'integer', minimum: 0, maximum: 2147483647 },
    attempts: { type: 'integer', minimum: 0 },
    credentialId: {
      type: 'string',
      format: 'uuid',
      description: 'Optional initiating managed key ID; never its secret.',
    },
    errorCode: { type: 'string', nullable: true },
  },
};
const asset = {
  type: 'object',
  required: ['path', 'revision', 'artifactId'],
  properties: {
    path: str,
    revision: storedRevision,
    artifactId: { type: 'string', format: 'uuid' },
  },
};
const assetRevision = {
  type: 'object',
  required: [...asset.required, 'actor', 'createdAt', 'sourceRevision'],
  properties: {
    ...asset.properties,
    actor: {
      type: 'string',
      nullable: true,
      description: 'Null for history recorded before migration 4',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Null for history recorded before migration 4',
    },
    sourceRevision: {
      ...storedRevision,
      nullable: true,
      description: 'Restored revision; null for ordinary replacement',
    },
  },
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
    get: operation('Recorded parts and the segment size chosen for this upload', {
      type: 'object',
      properties: {
        partBytes: {
          type: 'integer',
          minimum: 8388608,
          maximum: 1073741824,
          multipleOf: 8388608,
          description: 'Every part has this size except the last one.',
        },
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
    get: operation(
      'Cursor-paged, sorted and optionally grouped UPack versions',
      {
        type: 'object',
        required: ['items', 'groups', 'next'],
        properties: {
          items: { type: 'array', items: pkg },
          next: { type: 'string', nullable: true },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              required: ['group', 'name', 'artifactIds'],
              properties: {
                group: str,
                name: { type: 'string', nullable: true },
                artifactIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
      },
      {
        parameters: [
          query('group'),
          query('name'),
          {
            ...query('sort'),
            schema: { type: 'string', enum: ['group', 'name', 'version'] },
          },
          {
            ...query('direction'),
            schema: { type: 'string', enum: ['asc', 'desc'] },
          },
          {
            ...query('groupBy'),
            schema: { type: 'string', enum: ['none', 'group', 'package'] },
          },
          query('after'),
          { ...query('limit'), schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
      },
    ),
  },
  [`${root}/assets`]: {
    get: operation('Asset paths by prefix; narrow above 1000 results', page(asset), {
      parameters: [query('prefix')],
    }),
  },
  [`${root}/assets/page`]: {
    get: operation(
      'Cursor page of current asset pointers in UTF-8 byte order; literal prefix, no snapshot across pages',
      {
        type: 'object',
        required: ['items', 'next'],
        properties: {
          items: { type: 'array', maxItems: 100, items: asset },
          next: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 8192,
            pattern: '^[A-Za-z0-9_-]+$',
            description:
              'Opaque cursor bound to repository and prefix; null at end. Never grants access.',
          },
        },
      },
      {
        parameters: [
          {
            name: 'prefix',
            in: 'query',
            schema: { type: 'string', maxLength: 1024, default: '' },
            description: 'Case-sensitive literal prefix; % and _ are ordinary characters.',
          },
          {
            name: 'after',
            in: 'query',
            schema: { type: 'string', minLength: 1, maxLength: 8192, pattern: '^[A-Za-z0-9_-]+$' },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
      },
    ),
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
  [`${root}/asset/history`]: {
    get: operation(
      'Immutable revision history, newest first; at most 50 per page; unknown path is 404',
      {
        type: 'object',
        required: ['items', 'next'],
        properties: {
          items: { type: 'array', maxItems: 50, items: assetRevision },
          next: {
            ...storedRevision,
            nullable: true,
            description: 'Exclusive before cursor; null at end',
          },
        },
      },
      {
        parameters: [
          { ...query('path'), required: true },
          {
            name: 'before',
            in: 'query',
            schema: storedRevision,
            description: 'Only revisions strictly smaller than this value',
          },
        ],
      },
    ),
  },
  [`${root}/asset/revision`]: {
    get: operation(
      'Resolve immutable asset revision; download its artifact through the content API',
      assetRevision,
      {
        parameters: [
          { ...query('path'), required: true },
          { name: 'revision', in: 'query', required: true, schema: storedRevision },
        ],
      },
    ),
  },
  [`${root}/asset/restore`]: {
    post: operation(
      'Append a new revision pointing at historical bytes; CAS and audit are atomic. Repeating stale expectedRevision returns 409.',
      asset,
      {
        requestBody: request({
          type: 'object',
          additionalProperties: false,
          required: ['path', 'sourceRevision', 'expectedRevision'],
          properties: {
            path: str,
            sourceRevision: storedRevision,
            expectedRevision: { ...revision, minimum: 1 },
          },
        }),
      },
    ),
  },
  [`${root}/search`]: {
    get: operation(
      'Search names and metadata values (case-insensitive substring); exact label, collection and metadataKey/metadataValue pair; pages of 100',
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
      {
        parameters: [
          ...['q', 'label', 'collection', 'after'].map(query),
          {
            ...query('metadataKey'),
            description: 'Exact metadata key; requires metadataValue.',
            schema: { type: 'string', maxLength: 64, pattern: '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$' },
          },
          {
            ...query('metadataValue'),
            description:
              'Exact case-sensitive value; requires metadataKey. Empty string is allowed.',
            allowEmptyValue: true,
            schema: { type: 'string', maxLength: 1024 },
          },
        ],
      },
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
    schema:
      match[1] === 'index'
        ? { type: 'integer', minimum: 0, maximum: 9999 }
        : match[1] === 'repository'
          ? { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }
          : { type: 'string', format: 'uuid' },
  }));
export const catalogPaths = paths;

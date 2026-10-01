import { promotionActions, promotionModes } from './promotions.js';

const stage = { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,31}$' };
const repositoryName = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', format: 'uuid' };
const comment = { type: 'string', maxLength: 1024, nullable: true };
const stageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['artifactId', 'stage', 'promotedAt', 'actor', 'comment'],
  properties: {
    artifactId: uuid,
    stage,
    promotedAt: { type: 'string', format: 'date-time' },
    actor: { type: 'string' },
    comment,
  },
};
const eventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sequence',
    'repository',
    'artifactId',
    'action',
    'stage',
    'mode',
    'peerRepository',
    'peerArtifactId',
    'actor',
    'comment',
    'occurredAt',
  ],
  properties: {
    sequence: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
    repository: repositoryName,
    artifactId: uuid,
    action: { type: 'string', enum: promotionActions },
    stage: { ...stage, nullable: true },
    mode: { type: 'string', enum: [...promotionModes, null], nullable: true },
    peerRepository: { ...repositoryName, nullable: true },
    peerArtifactId: { ...uuid, nullable: true },
    actor: { type: 'string' },
    comment,
    occurredAt: { type: 'string', format: 'date-time' },
  },
};
const page = (item: object, cursor: object) => ({
  type: 'object',
  additionalProperties: false,
  required: ['items', 'next'],
  properties: {
    items: { type: 'array', maxItems: 100, items: item },
    next: { ...cursor, nullable: true },
  },
});
const stageList = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', maxItems: 16, items: stageSchema } },
};
const stageNames = { type: 'array', maxItems: 16, uniqueItems: true, items: stage };
export const resolvedPackageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'group',
    'name',
    'version',
    'artifactId',
    'sha256',
    'size',
    'publishedAt',
    'stagedAt',
    'stages',
  ],
  properties: {
    group: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    artifactId: uuid,
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    size: { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' },
    publishedAt: { type: 'string', format: 'date-time' },
    stagedAt: { type: 'string', format: 'date-time', nullable: true },
    stages: stageNames,
  },
};
const promotionResult = {
  type: 'object',
  additionalProperties: false,
  required: [
    'repository',
    'artifactId',
    'sourceRepository',
    'sourceArtifactId',
    'mode',
    'created',
    'stages',
  ],
  properties: {
    repository: repositoryName,
    artifactId: uuid,
    sourceRepository: repositoryName,
    sourceArtifactId: uuid,
    mode: { type: 'string', enum: promotionModes },
    created: { type: 'boolean' },
    stages: stageNames,
  },
};
const json = (schema: object, status = '200', description = 'Success') => ({
  [status]: { description, content: { 'application/json': { schema } } },
});
const query = (name: string, schema: object, description?: string) => ({
  name,
  in: 'query',
  schema,
  ...(description ? { description } : {}),
});
const path = (name: string, schema: object) => ({ name, in: 'path', required: true, schema });
const root = '/api/v1/repositories/{repository}';
const artifact = [path('repository', repositoryName), path('id', uuid)];
const limit = query('limit', { type: 'string', pattern: '^[1-9][0-9]{0,2}$' }, 'At most 100.');
const after = query('after', { type: 'string', pattern: '^[1-9][0-9]{0,18}$' });
export const packageQueryParameters = [
  query('group', { type: 'string', maxLength: 128 }),
  { ...query('name', { type: 'string', minLength: 1, maxLength: 128 }), required: true },
  query('version', { type: 'string', maxLength: 128 }, 'Exact version; excludes range.'),
  query(
    'range',
    { type: 'string', maxLength: 256 },
    'SemVer range: 1.2.3, ^1.2, ~1.2.3, 1.x, >=1.0.0 <2.0.0, a || b.',
  ),
  query('stage', stage, 'Only versions promoted to this stage.'),
  query('prerelease', { type: 'string', enum: ['true', 'false'] }, 'Include prereleases.'),
  query(
    'order',
    { type: 'string', enum: ['version', 'promoted'] },
    'promoted picks the most recently staged version and requires stage.',
  ),
];

export const promotionPaths = {
  [`${root}/artifacts/{id}/stages`]: {
    parameters: artifact,
    get: { summary: 'List promotion stages of an artifact', responses: json(stageList) },
  },
  [`${root}/artifacts/{id}/stages/{stage}`]: {
    parameters: [...artifact, path('stage', stage)],
    put: {
      summary: 'Add a promotion stage; repeating keeps the original time',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false, properties: { comment } },
          },
        },
      },
      responses: json(stageSchema),
    },
    delete: {
      summary: 'Remove a promotion stage; removing a missing stage succeeds',
      responses: { 204: { description: 'Removed or already absent' } },
    },
  },
  [`${root}/artifacts/{id}/promotions`]: {
    parameters: artifact,
    get: {
      summary: 'Promotion history of an artifact, oldest first',
      parameters: [after, limit],
      responses: json(page(eventSchema, { type: 'string' })),
    },
  },
  [`${root}/artifacts/{id}/promote`]: {
    parameters: artifact,
    post: {
      summary: 'Publish the artifact in another repository without re-uploading bytes',
      description:
        'copy keeps the source; move retires it in the same transaction. Repeating returns the existing copy with 200.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['target'],
              properties: {
                target: repositoryName,
                mode: { type: 'string', enum: promotionModes },
                stages: stageNames,
                comment,
              },
            },
          },
        },
      },
      responses: {
        ...json(promotionResult, '201', 'Copy published'),
        ...json(promotionResult, '200', 'Existing copy returned'),
      },
    },
  },
  [`${root}/stages`]: {
    parameters: [path('repository', repositoryName)],
    get: {
      summary: 'Artifacts with promotion stages, optionally one stage',
      parameters: [
        query('stage', stage),
        query('after', { type: 'string' }),
        limit,
        query(
          'ids',
          { type: 'string', maxLength: 3699 },
          'Up to 100 comma-separated artifact ids.',
        ),
      ],
      responses: json(page(stageSchema, { type: 'string' })),
    },
  },
  [`${root}/promotions`]: {
    parameters: [path('repository', repositoryName)],
    get: {
      summary: 'Promotion journal of the repository for CI/CD polling, oldest first',
      parameters: [after, limit],
      responses: json(page(eventSchema, { type: 'string' })),
    },
  },
  [`${root}/packages/resolve`]: {
    parameters: [path('repository', repositoryName)],
    get: {
      summary: 'Resolve a UPack version by exact version, SemVer range and stage',
      parameters: packageQueryParameters,
      responses: json(resolvedPackageSchema),
    },
  },
};

/** [suffix, method, operationId, actions, coarse permissions, retry] under the repository root. */
export const promotionOperations = [
  ['/artifacts/{id}/stages', 'get', 'listArtifactStages', ['artifact.read'], ['read'], 'read'],
  [
    '/artifacts/{id}/stages/{stage}',
    'put',
    'setArtifactStage',
    ['artifact.promote', 'artifact.read'],
    ['read', 'write'],
    'idempotent',
  ],
  [
    '/artifacts/{id}/stages/{stage}',
    'delete',
    'removeArtifactStage',
    ['artifact.promote', 'artifact.read'],
    ['read', 'write'],
    'idempotent',
  ],
  [
    '/artifacts/{id}/promotions',
    'get',
    'listArtifactPromotions',
    ['artifact.read'],
    ['read'],
    'read',
  ],
  [
    '/artifacts/{id}/promote',
    'post',
    'promoteArtifact',
    ['artifact.read', 'content.read'],
    ['read'],
    'idempotent',
  ],
  ['/stages', 'get', 'listStagedArtifacts', ['artifact.list'], ['read'], 'read'],
  ['/promotions', 'get', 'listRepositoryPromotions', ['artifact.list'], ['read'], 'read'],
  ['/packages/resolve', 'get', 'resolvePackage', ['package.read'], ['read'], 'read'],
] as const;

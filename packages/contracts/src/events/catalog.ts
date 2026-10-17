/*
 * Event catalog of ADR 0080: every type with its schema version, scope, read permission,
 * partition and the JSON Schema of `data`. Changes are additive: a new optional field keeps the
 * schema version, an incompatible change is a new version. The domain holds the same catalog
 * (contracts never depend on domain); a unit test keeps both equal.
 */

export type EventScopeName = 'repository' | 'system';
export interface EventTypeDescription {
  /** Name without prefix or version, e.g. `artifact.published`. */
  readonly name: string;
  readonly schemaVersion: number;
  readonly scope: EventScopeName;
  /** `artifact.list` on the event's repository, or global administration for system events. */
  readonly permission: 'artifact.list' | 'administrator';
  /** `repository` (one ordered stream per repository) or `system:<source>`. */
  readonly partition: string;
  readonly description: string;
  readonly dataSchema: Readonly<Record<string, unknown>>;
}

const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' } as const;
const text = { type: 'string' } as const;
const common = {
  repository: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  artifactId: { type: 'string', format: 'uuid' },
  name: { ...text, description: 'File name of the artifact' },
  size: { ...decimal, description: 'Size in bytes as a decimal string' },
  sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  labels: { type: 'array', maxItems: 32, items: text, description: 'Labels at the event' },
  stages: { type: 'array', maxItems: 16, items: text, description: 'Stages at the event' },
  package: {
    type: 'object',
    required: ['group', 'name', 'version'],
    properties: { group: text, name: text, version: text },
    description: 'UPack registration of the artifact, when it has one',
  },
  truncated: {
    type: 'boolean',
    description: 'Present when lists or the name were left out to keep data within 8 KiB',
  },
} as const;
const specific = {
  path: { ...text, description: 'File path in the repository' },
  stage: text,
  oid: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Git LFS object id' },
  image: text,
  digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  tag: text,
  npm: {
    type: 'object',
    required: ['name'],
    properties: { name: text, version: text, tag: text },
    description: 'npm package, version and dist-tag of the change',
  },
} as const;
type Specific = keyof typeof specific;

function repositoryType(
  name: string,
  description: string,
  fields: readonly Specific[] = [],
): EventTypeDescription {
  return {
    name,
    schemaVersion: 1,
    scope: 'repository',
    permission: 'artifact.list',
    partition: 'repository',
    description,
    dataSchema: {
      type: 'object',
      required: ['repository', 'artifactId', ...fields],
      properties: {
        ...common,
        ...Object.fromEntries(fields.map((field) => [field, specific[field]])),
      },
    },
  };
}

export const eventCatalog: readonly EventTypeDescription[] = [
  repositoryType('artifact.published', 'An upload completed and the artifact is published.'),
  repositoryType('artifact.deleted', 'An artifact was deleted (retention or an explicit delete).'),
  repositoryType('asset.revision.created', 'A file path points to a new revision.', ['path']),
  repositoryType('asset.restored', 'A file path was restored to an earlier revision.', ['path']),
  repositoryType('package.registered', 'A UPack artifact was registered as a package version.'),
  repositoryType('annotation.updated', 'Labels, metadata or collections of an artifact changed.'),
  repositoryType('attachments.updated', 'The build attachments of an artifact were replaced.'),
  repositoryType('stage.added', 'A stage was added to an artifact.', ['stage']),
  repositoryType('stage.removed', 'A stage was removed from an artifact.', ['stage']),
  repositoryType('artifact.promoted', 'An artifact was promoted to another repository.'),
  repositoryType('artifact.received', 'An artifact arrived by promotion from another repository.'),
  repositoryType('oci.manifest.pushed', 'An image manifest was pushed.', ['image', 'digest']),
  repositoryType('oci.manifest.deleted', 'An image manifest was deleted.', ['image', 'digest']),
  repositoryType('oci.tag.updated', 'An image tag points to a manifest.', ['image', 'tag']),
  repositoryType('oci.tag.deleted', 'An image tag was deleted.', ['image', 'tag']),
  repositoryType('npm.version.published', 'An npm package version was published.', ['npm']),
  repositoryType('npm.tag.updated', 'An npm dist-tag points to a version.', ['npm']),
  repositoryType('npm.tag.deleted', 'An npm dist-tag was removed.', ['npm']),
  repositoryType('lfs.object.stored', 'A Git LFS object was stored.', ['oid']),
];

/** CloudEvents `type` of a catalog entry: `arkvory.<name>.v<schemaVersion>`. */
export const cloudEventType = (name: string, schemaVersion: number) =>
  `arkvory.${name}.v${String(schemaVersion)}`;
/** CloudEvents `dataschema`: `urn:arkvory:event:<name>:<schemaVersion>`. */
export const eventDataSchemaUri = (name: string, schemaVersion: number) =>
  `urn:arkvory:event:${name}:${String(schemaVersion)}`;
/** Name of the data schema of a type under OpenAPI `components.schemas`. */
export const eventSchemaName = (name: string, schemaVersion: number) =>
  `event.${name}.v${String(schemaVersion)}`;

export const eventDataSchemas: Readonly<Record<string, unknown>> = Object.fromEntries(
  eventCatalog.map((type) => [
    eventSchemaName(type.name, type.schemaVersion),
    { ...type.dataSchema, description: type.description },
  ]),
);

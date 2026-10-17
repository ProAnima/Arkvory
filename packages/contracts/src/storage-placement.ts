import { integer, items, record, text } from './wire-values.js';

/** One placement rule: the first rule whose conditions all hold names the storage. */
export interface StoragePlacementRule {
  readonly id: string;
  readonly backendId: string;
  /** A package group, `prefix/*` or `*`; null matches every upload. */
  readonly packageGroup: string | null;
  /** Decimal bytes; the rule holds for objects at least this large. Null: any size. */
  readonly minSizeBytes: string | null;
}

/**
 * Whether a storage takes new uploads: `accepting`, or why not (`not_loaded`, `disabled`,
 * `unavailable`, `read_only`, `not_accepting`); later versions may add states, every unknown
 * one means not accepting.
 */
export interface StoragePlacementBackend {
  readonly id: string;
  readonly state: string;
}

/** Placement of new uploads of one repository (ADR 0083, N11). */
export interface StoragePlacement {
  /** 0 until the policy is first saved. */
  readonly revision: number;
  readonly rules: readonly StoragePlacementRule[];
  readonly updatedAt: string | null;
  /** The storages of the answering server, `default` first. */
  readonly backends: readonly StoragePlacementBackend[];
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const backendId = {
  type: 'string',
  pattern: '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)?$',
  minLength: 1,
  maxLength: 64,
};
const ruleSchema = object({
  id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
  backendId,
  packageGroup: { type: 'string', minLength: 1, maxLength: 256, nullable: true },
  minSizeBytes: { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$', nullable: true },
});
const rules = { type: 'array', maxItems: 32, items: ruleSchema };
const revision = { type: 'integer', minimum: 0, maximum: 2147483647 };

export const storagePlacementSchema = object({
  revision,
  rules,
  updatedAt: { type: 'string', format: 'date-time', nullable: true },
  backends: {
    type: 'array',
    maxItems: 64,
    items: object({ id: backendId, state: { type: 'string', pattern: '^[a-z][a-z_]{0,31}$' } }),
  },
});

const response = {
  200: {
    description:
      'The rules and the state of each storage; a storage that takes no new data is skipped and the upload goes to default',
    content: { 'application/json': { schema: storagePlacementSchema } },
  },
};

export const storagePlacementPaths = {
  '/api/v1/repositories/{repository}/storage/placement': {
    parameters: [
      {
        name: 'repository',
        in: 'path',
        required: true,
        schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
      },
    ],
    get: { summary: 'Read where new uploads of the repository are stored', responses: response },
    put: {
      summary:
        'Replace the placement rules with a revision check; only new uploads follow them, stored data never moves',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: object({ expectedRevision: revision, rules }) },
        },
      },
      responses: response,
    },
  },
};

const nullableText = (value: unknown): string | null => (value === null ? null : text(value));

/** Validates the placement of a server; fields a newer server adds are left out. */
export function readStoragePlacement(value: unknown): StoragePlacement {
  const row = record(value);
  return {
    revision: integer(row['revision']),
    rules: items(row['rules']).map((entry) => {
      const rule = record(entry);
      return {
        id: text(rule['id']),
        backendId: text(rule['backendId']),
        packageGroup: nullableText(rule['packageGroup']),
        minSizeBytes: nullableText(rule['minSizeBytes']),
      };
    }),
    updatedAt: nullableText(row['updatedAt']),
    backends: items(row['backends']).map((entry) => {
      const backend = record(entry);
      return { id: text(backend['id']), state: text(backend['state']) };
    }),
  };
}

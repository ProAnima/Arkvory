import { integer, record, text } from './wire-values.js';

/** Download queue settings of ADR 0076 stage 3: [path, method, operationId, access, retry]. */
export const downloadSettingsOperations = [
  ['/system/downloads/settings', 'get', 'getDownloadSettings', 'administrator', 'read'],
  [
    '/system/downloads/settings',
    'put',
    'changeDownloadSettings',
    'administrator',
    'compare-and-swap',
  ],
] as const;

export const downloadClassNames = ['interactive', 'release', 'bulk', 'background'] as const;
export const downloadStrategyNames = ['ordered', 'smallest-first', 'shared'] as const;

export interface DownloadSettingValues {
  readonly strategy: (typeof downloadStrategyNames)[number];
  readonly sessions: number;
  readonly reserve: number;
  readonly perPrincipal: number;
  readonly weights: Readonly<Record<(typeof downloadClassNames)[number], number>>;
  readonly sessionMinBytes: number;
  readonly idleSeconds: number;
  readonly agingMinutes: number;
  readonly preempt: boolean;
  readonly rangesPerSession: number;
}
export type DownloadOverrides = Partial<DownloadSettingValues>;

export interface DownloadSettings {
  /** 0 until the settings are first changed; pass it back as `expectedRevision`. */
  readonly revision: number;
  readonly overrides: DownloadOverrides;
  readonly defaults: DownloadSettingValues;
  readonly effective: DownloadSettingValues;
  /** `per-request` under `shared`: the session settings wait unused. */
  readonly admission: 'sessions' | 'per-request';
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
  readonly actor: string | null;
  readonly problem: string | null;
}

export interface DownloadSettingsChange {
  readonly expectedRevision: number;
  readonly overrides: DownloadOverrides;
}

const whole = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const object = (properties: Record<string, unknown>, required: readonly string[]) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const valueProperties = {
  strategy: { type: 'string', enum: downloadStrategyNames },
  sessions: whole(1, 1024),
  reserve: whole(0, 1023),
  perPrincipal: whole(1, 1024),
  weights: object(
    Object.fromEntries(downloadClassNames.map((name) => [name, whole(1, 1000)])),
    downloadClassNames,
  ),
  sessionMinBytes: whole(0, Number.MAX_SAFE_INTEGER),
  idleSeconds: whole(1, 3600),
  agingMinutes: whole(0, 10080),
  preempt: { type: 'boolean' },
  rangesPerSession: whole(1, 64),
};
const values = object(valueProperties, Object.keys(valueProperties));
const overrides = object(valueProperties, []);
const nullableText = { type: 'string', nullable: true };
const settingsSchema = object(
  {
    revision: whole(0, Number.MAX_SAFE_INTEGER),
    overrides,
    defaults: values,
    effective: values,
    admission: { type: 'string', enum: ['sessions', 'per-request'] },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
    updatedBy: nullableText,
    actor: nullableText,
    problem: nullableText,
  },
  [
    'revision',
    'overrides',
    'defaults',
    'effective',
    'admission',
    'updatedAt',
    'updatedBy',
    'actor',
    'problem',
  ],
);
const json = (schema: unknown) => ({ 'application/json': { schema } });

export const downloadSettingsPaths = {
  '/api/v1/system/downloads/settings': {
    get: {
      summary: 'Read the download queue settings: changed values, defaults and what runs now',
      responses: { 200: { description: 'The settings', content: json(settingsSchema) } },
    },
    put: {
      summary:
        'Change the download queue settings without a restart; the values given replace all earlier changes',
      requestBody: {
        required: true,
        content: json(
          object({ expectedRevision: whole(0, Number.MAX_SAFE_INTEGER), overrides }, [
            'expectedRevision',
            'overrides',
          ]),
        ),
      },
      responses: { 200: { description: 'The settings as saved', content: json(settingsSchema) } },
    },
  },
};

const flag = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
  return value;
};
const optionalText = (value: unknown) => (value === null ? null : text(value));
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new Error('Invalid server enumeration');
  return found;
}
function readWeights(value: unknown) {
  const row = record(value);
  return {
    interactive: integer(row['interactive']),
    release: integer(row['release']),
    bulk: integer(row['bulk']),
    background: integer(row['background']),
  };
}
function readValues(value: unknown): DownloadSettingValues {
  const row = record(value);
  return {
    strategy: oneOf(row['strategy'], downloadStrategyNames),
    sessions: integer(row['sessions']),
    reserve: integer(row['reserve']),
    perPrincipal: integer(row['perPrincipal']),
    weights: readWeights(row['weights']),
    sessionMinBytes: integer(row['sessionMinBytes']),
    idleSeconds: integer(row['idleSeconds']),
    agingMinutes: integer(row['agingMinutes']),
    preempt: flag(row['preempt']),
    rangesPerSession: integer(row['rangesPerSession']),
  };
}
function readOverrides(value: unknown): DownloadOverrides {
  const row = record(value);
  // Settings a newer server knows are left out, not refused: the contract grows additively.
  const result: { -readonly [K in keyof DownloadSettingValues]?: DownloadSettingValues[K] } = {};
  if (row['strategy'] !== undefined)
    result.strategy = oneOf(row['strategy'], downloadStrategyNames);
  if (row['weights'] !== undefined) result.weights = readWeights(row['weights']);
  if (row['preempt'] !== undefined) result.preempt = flag(row['preempt']);
  const counts = [
    'sessions',
    'reserve',
    'perPrincipal',
    'sessionMinBytes',
    'idleSeconds',
    'agingMinutes',
    'rangesPerSession',
  ] as const;
  for (const name of counts) if (row[name] !== undefined) result[name] = integer(row[name]);
  return result;
}

/** Validates `GET`/`PUT /api/v1/system/downloads/settings`. */
export function readDownloadSettings(value: unknown): DownloadSettings {
  const row = record(value);
  return {
    revision: integer(row['revision']),
    overrides: readOverrides(row['overrides']),
    defaults: readValues(row['defaults']),
    effective: readValues(row['effective']),
    admission: oneOf(row['admission'], ['sessions', 'per-request'] as const),
    updatedAt: optionalText(row['updatedAt']),
    updatedBy: optionalText(row['updatedBy']),
    actor: optionalText(row['actor']),
    problem: optionalText(row['problem']),
  };
}

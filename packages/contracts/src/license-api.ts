import { integer, items, record, text } from './wire-values.js';

/** Licences of the installation (ADR 0078, 8 and R2): [path, method, operationId, access, retry]. */
export const licenseOperations = [
  ['/system/license', 'get', 'getSystemLicense', 'administrator', 'read'],
] as const;

/** One licence as the installation verified it; times are ISO 8601 UTC. */
export interface SystemLicense {
  readonly licenseId: string;
  readonly activationId: string;
  readonly licensee: string | null;
  /** `trial`, `standard`, `multi-site`, `enterprise`, or a newer type shown as it is. */
  readonly licenseType: string | null;
  /** `online` or `offline`. */
  readonly activation: string;
  readonly features: readonly string[];
  /** Decimal strings of unsigned 64-bit values. */
  readonly limits: Readonly<Record<string, string>>;
  /** The end of the licence term; null for a perpetual licence. */
  readonly notAfter: string | null;
  readonly graceUntil: string | null;
  /** The end of the current token: without a refresh, paid writes stop there. */
  readonly offlineGraceUntil: string | null;
  readonly lastRefreshAt: string | null;
  readonly refreshFailing: boolean;
  /**
   * `valid`, `offline-grace`, `grace`, `expired`, `revoked`, `mismatch` or `invalid`; later
   * versions may add states, unknown ones mean not valid.
   */
  readonly state: string;
  readonly reason: string | null;
}

export interface SystemLicenses {
  /** The installation id the writer recorded (`config/install-id`); null before it did. */
  readonly installation: string | null;
  /** The time licences are judged by; a clock set back does not move it back. */
  readonly effectiveTime: string;
  /** The database clock is more than a day behind a time already seen. */
  readonly clockRollback: boolean;
  /** Offline activation requests waiting for their answer. */
  readonly pendingRequests: number;
  readonly licenses: readonly SystemLicense[];
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const time = { type: 'string', format: 'date-time', maxLength: 32 };
const nullableTime = { ...time, nullable: true };
const word = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$', maxLength: 64 };
const code = { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$', maxLength: 64, nullable: true };
const name = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9._-]{0,63}$', maxLength: 64 };

export const systemLicenseSchema = object({
  installation: { type: 'string', maxLength: 64, nullable: true },
  effectiveTime: time,
  clockRollback: { type: 'boolean' },
  pendingRequests: { type: 'integer', minimum: 0 },
  licenses: {
    type: 'array',
    maxItems: 64,
    items: object({
      licenseId: { type: 'string', pattern: '^lic_[0-9A-Z]{26}$' },
      activationId: { type: 'string', pattern: '^act_[0-9A-Z]{26}$' },
      licensee: { type: 'string', maxLength: 512, nullable: true },
      licenseType: { ...word, nullable: true },
      activation: word,
      features: { type: 'array', maxItems: 256, items: name },
      limits: {
        type: 'object',
        maxProperties: 256,
        additionalProperties: { type: 'string', pattern: '^[0-9]{1,20}$' },
      },
      notAfter: nullableTime,
      graceUntil: nullableTime,
      offlineGraceUntil: nullableTime,
      lastRefreshAt: nullableTime,
      refreshFailing: { type: 'boolean' },
      state: word,
      reason: code,
    }),
  },
});

export const licensePaths = {
  '/api/v1/system/license': {
    get: {
      summary:
        'Show the licences of this installation: type, licensee, features, limits, terms, offline window and state, judged at effective time',
      responses: {
        200: {
          description:
            'Every activation the installation keeps, verified again on each request; no licence key, activation secret or signature bytes. The free core works without any licence.',
          content: { 'application/json': { schema: systemLicenseSchema } },
        },
      },
    },
  },
};

const flag = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
  return value;
};
const optional = (value: unknown): string | null => (value === null ? null : text(value));

function readLimits(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, limit]) => {
      const digits = text(limit);
      if (!/^[0-9]{1,20}$/.test(digits)) throw new Error('Invalid server limit');
      return [key, digits];
    }),
  );
}

function readLicense(value: unknown): SystemLicense {
  const row = record(value);
  return {
    licenseId: text(row['licenseId']),
    activationId: text(row['activationId']),
    licensee: optional(row['licensee']),
    licenseType: optional(row['licenseType']),
    activation: text(row['activation']),
    features: items(row['features']).map(text),
    limits: readLimits(row['limits']),
    notAfter: optional(row['notAfter']),
    graceUntil: optional(row['graceUntil']),
    offlineGraceUntil: optional(row['offlineGraceUntil']),
    lastRefreshAt: optional(row['lastRefreshAt']),
    refreshFailing: flag(row['refreshFailing']),
    state: text(row['state']),
    reason: optional(row['reason']),
  };
}

/** Validates `GET /api/v1/system/license`; new fields of a newer server are left out. */
export function readSystemLicenses(value: unknown): SystemLicenses {
  const row = record(value);
  return {
    installation: optional(row['installation']),
    effectiveTime: text(row['effectiveTime']),
    clockRollback: flag(row['clockRollback']),
    pendingRequests: integer(row['pendingRequests']),
    licenses: items(row['licenses']).map(readLicense),
  };
}

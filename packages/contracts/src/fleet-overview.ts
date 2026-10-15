import { items, record, text } from './wire-values.js';

export const fleetAlertKinds = [
  'unreachable',
  'certificate',
  'revoked',
  'refused',
  'invalid',
  'stale',
  'not-writable',
  'copies',
  'single-copy',
  'mirror-failing',
  'mirror-lag',
  'updates-failed',
  'version-skew',
] as const;
export const fleetAlertSeverities = ['critical', 'warning', 'info'] as const;

export interface FleetOverviewAlert {
  /** `self` for this installation, else the site id. */
  readonly site: string;
  readonly name: string;
  readonly kind: (typeof fleetAlertKinds)[number];
  readonly severity: (typeof fleetAlertSeverities)[number];
  readonly subject: string | null;
  readonly since: string | null;
}
export interface FleetOverviewLink {
  /** A site id, `self`, or `external:<origin>`. */
  readonly from: string;
  readonly to: string;
  readonly repository: string;
  readonly sourceRepository: string;
  readonly mode: 'mirror' | 'import';
  readonly lagChanges: string | null;
  readonly failing: boolean;
  /**
   * The mirror's site did not answer its last read: the link is as it last reported. Optional on
   * the wire (added after F4); an older controller that does not send it means false.
   */
  readonly stale: boolean;
}
/** The fleet at a glance (ADR 0077, stage F4): what needs attention and who feeds whom. */
export interface FleetOverview {
  readonly generatedAt: string;
  readonly self: { readonly name: string; readonly version: string; readonly url: string | null };
  readonly alerts: readonly FleetOverviewAlert[];
  readonly links: readonly FleetOverviewLink[];
  readonly external: readonly string[];
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const nullable = (schema: Record<string, unknown>) => ({ ...schema, nullable: true });
const string = { type: 'string' };
const time = { type: 'string', format: 'date-time' };
const linkProperties = {
  from: string,
  to: string,
  repository: string,
  sourceRepository: string,
  mode: { type: 'string', enum: ['mirror', 'import'] },
  lagChanges: nullable({ type: 'string', pattern: '^(0|[1-9][0-9]*)$' }),
  failing: { type: 'boolean' },
};
export const fleetOverviewSchema = object({
  generatedAt: time,
  self: object({ name: string, version: string, url: nullable(string) }),
  alerts: {
    type: 'array',
    items: object({
      site: string,
      name: string,
      kind: { type: 'string', enum: fleetAlertKinds },
      severity: { type: 'string', enum: fleetAlertSeverities },
      subject: nullable(string),
      since: nullable(time),
    }),
  },
  links: {
    type: 'array',
    // `stale` is not required: added after F4, readers take its absence as false.
    items: {
      ...object(linkProperties),
      properties: { ...linkProperties, stale: { type: 'boolean' } },
    },
  },
  external: { type: 'array', items: string },
});

const optional = (value: unknown) => (value === null ? null : text(value));
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new Error('Invalid server enumeration');
  return found;
}
function flag(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
  return value;
}

/**
 * Validates `GET /api/v1/fleet/overview`. An alert of a kind this release does not know is left
 * out rather than failing the page: newer controllers may add kinds.
 */
export function readFleetOverview(value: unknown): FleetOverview {
  const row = record(value);
  const self = record(row['self']);
  return {
    generatedAt: text(row['generatedAt']),
    self: { name: text(self['name']), version: text(self['version']), url: optional(self['url']) },
    alerts: items(row['alerts']).flatMap((entry) => {
      const alert = record(entry);
      if (!fleetAlertKinds.some((kind) => kind === alert['kind'])) return [];
      return [
        {
          site: text(alert['site']),
          name: text(alert['name']),
          kind: oneOf(alert['kind'], fleetAlertKinds),
          severity: oneOf(alert['severity'], fleetAlertSeverities),
          subject: optional(alert['subject']),
          since: optional(alert['since']),
        },
      ];
    }),
    links: items(row['links']).map((entry) => {
      const link = record(entry);
      return {
        from: text(link['from']),
        to: text(link['to']),
        repository: text(link['repository']),
        sourceRepository: text(link['sourceRepository']),
        mode: oneOf(link['mode'], ['mirror', 'import'] as const),
        lagChanges: optional(link['lagChanges']),
        failing: flag(link['failing']),
        stale: link['stale'] === undefined ? false : flag(link['stale']),
      };
    }),
    external: items(row['external']).map(text),
  };
}

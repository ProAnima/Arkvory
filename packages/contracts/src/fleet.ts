import { integer, items, record, text } from './wire-values.js';

/** One installation as the fleet console sees it (ADR 0077). */
export interface SiteTopology {
  readonly collectedAt: string;
  readonly site: {
    readonly name: string;
    readonly version: string;
    readonly schema: number;
    readonly role: 'api' | 'reader';
  };
  readonly health: {
    readonly available: boolean;
    readonly writable: boolean;
    readonly draining: boolean;
  };
  readonly replication: SiteReplication | null;
  readonly gateways: readonly {
    readonly slot: number;
    readonly active: boolean;
    readonly expiresAt: string;
  }[];
  readonly mirrors: readonly SiteMirror[];
  readonly updates: SiteUpdates | null;
  readonly downloads: SiteDownloads;
}
export interface SiteReplication {
  readonly copies: number;
  readonly required: number;
  readonly singleCopyUntil: string | null;
  readonly node?: string;
  readonly profile?: string;
  readonly peers?: readonly {
    readonly name: string;
    readonly connected: boolean;
    readonly disk: string;
    readonly complete: boolean;
    readonly witness: boolean;
  }[];
}
export interface SiteMirror {
  readonly repository: string;
  readonly mode: 'mirror' | 'import';
  readonly upstream: string;
  readonly sourceRepository: string;
  readonly phase: string;
  readonly errorCode: string | null;
  readonly checkedAt: string | null;
  readonly syncedAt: string | null;
  /** Changes of the source not applied yet; null before the first check. */
  readonly lagChanges: string | null;
  readonly copiedArtifacts: number;
  readonly copiedBytes: string;
}
export interface SiteUpdates {
  readonly currentVersion: string;
  readonly latest: string | null;
  readonly phase: string;
  readonly error: string | null;
  readonly automatic: boolean;
  readonly heartbeatAt: string;
}
export interface SiteDownloads {
  readonly strategy: 'ordered' | 'smallest-first' | 'shared';
  readonly sessions: number;
  readonly active: number;
  readonly waiting: number;
  readonly oldestWaitSeconds: number;
  readonly bytesPerSecond: number;
}

const flag = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
  return value;
};
const decimal = (value: unknown): string => {
  const parsed = text(value);
  if (!/^(0|[1-9][0-9]*)$/.test(parsed)) throw new Error('Invalid server decimal');
  return parsed;
};
/**
 * Changes behind: a decimal of at most 30 digits. Far beyond any real feed, and short enough that
 * the controller's arithmetic and gauges stay bounded whatever a site sends.
 */
const lag = (value: unknown): string => {
  const parsed = decimal(value);
  if (parsed.length > 30) throw new Error('Invalid server decimal');
  return parsed;
};
const nullable = <T>(value: unknown, read: (value: unknown) => T): T | null =>
  value === null ? null : read(value);
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new Error('Invalid server enumeration');
  return found;
}

function readReplication(value: unknown): SiteReplication {
  const row = record(value);
  return {
    copies: integer(row['copies']),
    required: integer(row['required']),
    singleCopyUntil: nullable(row['singleCopyUntil'], text),
    ...(row['node'] === undefined ? {} : { node: text(row['node']) }),
    ...(row['profile'] === undefined ? {} : { profile: text(row['profile']) }),
    ...(row['peers'] === undefined
      ? {}
      : {
          peers: items(row['peers']).map((entry) => {
            const peer = record(entry);
            return {
              name: text(peer['name']),
              connected: flag(peer['connected']),
              disk: text(peer['disk']),
              complete: flag(peer['complete']),
              witness: flag(peer['witness']),
            };
          }),
        }),
  };
}

function readMirror(value: unknown): SiteMirror {
  const row = record(value);
  return {
    repository: text(row['repository']),
    mode: oneOf(row['mode'], ['mirror', 'import'] as const),
    upstream: text(row['upstream']),
    sourceRepository: text(row['sourceRepository']),
    phase: text(row['phase']),
    errorCode: nullable(row['errorCode'], text),
    checkedAt: nullable(row['checkedAt'], text),
    syncedAt: nullable(row['syncedAt'], text),
    lagChanges: nullable(row['lagChanges'], lag),
    copiedArtifacts: integer(row['copiedArtifacts']),
    copiedBytes: decimal(row['copiedBytes']),
  };
}

function readUpdates(value: unknown): SiteUpdates {
  const row = record(value);
  return {
    currentVersion: text(row['currentVersion']),
    latest: nullable(row['latest'], text),
    phase: text(row['phase']),
    error: nullable(row['error'], text),
    automatic: flag(row['automatic']),
    heartbeatAt: text(row['heartbeatAt']),
  };
}

/** Validates `GET /api/v1/system/topology`; anything unexpected is an invalid response. */
export function readTopology(value: unknown): SiteTopology {
  const row = record(value);
  const site = record(row['site']);
  const health = record(row['health']);
  const downloads = record(row['downloads']);
  return {
    collectedAt: text(row['collectedAt']),
    site: {
      name: text(site['name']),
      version: text(site['version']),
      schema: integer(site['schema']),
      role: oneOf(site['role'], ['api', 'reader'] as const),
    },
    health: {
      available: flag(health['available']),
      writable: flag(health['writable']),
      draining: flag(health['draining']),
    },
    replication: nullable(row['replication'], readReplication),
    gateways: items(row['gateways']).map((entry) => {
      const gateway = record(entry);
      return {
        slot: integer(gateway['slot']),
        active: flag(gateway['active']),
        expiresAt: text(gateway['expiresAt']),
      };
    }),
    mirrors: items(row['mirrors']).map(readMirror),
    updates: nullable(row['updates'], readUpdates),
    downloads: {
      strategy: oneOf(downloads['strategy'], ['ordered', 'smallest-first', 'shared'] as const),
      sessions: integer(downloads['sessions']),
      active: integer(downloads['active']),
      waiting: integer(downloads['waiting']),
      oldestWaitSeconds: integer(downloads['oldestWaitSeconds']),
      bytesPerSecond: integer(downloads['bytesPerSecond']),
    },
  };
}

/** A managed site as the controller shows it (ADR 0077). */
export interface FleetSite {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly fingerprint: string | null;
  readonly addedBy: string;
  readonly addedAt: string;
  readonly seenAt: string | null;
  readonly state:
    'pending' | 'ok' | 'unreachable' | 'certificate' | 'revoked' | 'invalid' | 'refused';
  readonly error: string | null;
  readonly topology: SiteTopology | null;
}
export interface FleetProbe {
  readonly url: string;
  readonly certificate: {
    readonly fingerprint: string;
    readonly subject: string;
    readonly issuer: string;
    readonly validTo: string;
  } | null;
}
export interface FleetPairing {
  readonly code: string;
  readonly expiresAt: string;
  /** This site's certificate fingerprint with built-in HTTPS; null behind a TLS proxy. */
  readonly fingerprint: string | null;
}
export interface FleetController {
  readonly id: string;
  readonly name: string;
  readonly pairedBy: string;
  readonly pairedAt: string;
  readonly usedAt: string | null;
}

const siteStates = [
  'pending',
  'ok',
  'unreachable',
  'certificate',
  'revoked',
  'invalid',
  'refused',
] as const;

export function readFleetSite(value: unknown): FleetSite {
  const row = record(value);
  return {
    id: text(row['id']),
    name: text(row['name']),
    url: text(row['url']),
    fingerprint: nullable(row['fingerprint'], text),
    addedBy: text(row['addedBy']),
    addedAt: text(row['addedAt']),
    seenAt: nullable(row['seenAt'], text),
    state: oneOf(row['state'], siteStates),
    error: nullable(row['error'], text),
    topology: nullable(row['topology'], readTopology),
  };
}
export function readFleetSites(value: unknown): readonly FleetSite[] {
  return items(record(value)['items']).map(readFleetSite);
}
export function readFleetProbe(value: unknown): FleetProbe {
  const row = record(value);
  return {
    url: text(row['url']),
    certificate: nullable(row['certificate'], (entry) => {
      const certificate = record(entry);
      return {
        fingerprint: text(certificate['fingerprint']),
        subject: text(certificate['subject']),
        issuer: text(certificate['issuer']),
        validTo: text(certificate['validTo']),
      };
    }),
  };
}
export function readFleetPairing(value: unknown): FleetPairing {
  const row = record(value);
  return {
    code: text(row['code']),
    expiresAt: text(row['expiresAt']),
    fingerprint: nullable(row['fingerprint'], text),
  };
}
export function readFleetControllers(value: unknown): readonly FleetController[] {
  return items(record(value)['items']).map((entry) => {
    const row = record(entry);
    return {
      id: text(row['id']),
      name: text(row['name']),
      pairedBy: text(row['pairedBy']),
      pairedAt: text(row['pairedAt']),
      usedAt: nullable(row['usedAt'], text),
    };
  });
}

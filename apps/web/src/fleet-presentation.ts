import type { FleetSite, SiteTopology } from '@proanima/arkvory-contracts';
import type { MessageKey } from './messages.js';

/** One line of the page: a message and its parameters. */
export interface Line {
  readonly key: MessageKey;
  readonly params: Readonly<Record<string, string | number>>;
}

export const stateKeys: Readonly<Record<FleetSite['state'], MessageKey>> = {
  ok: 'fleetStateOk',
  pending: 'fleetStatePending',
  unreachable: 'fleetStateUnreachable',
  certificate: 'fleetStateCertificate',
  revoked: 'fleetStateRevoked',
  invalid: 'fleetStateInvalid',
  refused: 'fleetStateRefused',
};

/** What to do about a site that was not read; nothing while it works. */
export const hintKeys: Readonly<Partial<Record<FleetSite['state'], MessageKey>>> = {
  unreachable: 'fleetHintUnreachable',
  certificate: 'fleetHintCertificate',
  revoked: 'fleetHintRevoked',
  invalid: 'fleetHintInvalid',
  refused: 'fleetHintRefused',
};

/** `AB:CD:…` in upper case, as browsers and openssl show a SHA-256 fingerprint. */
export function fingerprintText(hex: string): string {
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

/** The role is a message of its own, so the version line can be built from translated parts. */
export const roleKeys: Readonly<Record<SiteTopology['site']['role'], MessageKey>> = {
  api: 'fleetRoleApi',
  reader: 'fleetRoleReader',
};

export function copiesLine(topology: SiteTopology): Line {
  const replication = topology.replication;
  return replication
    ? {
        key: 'fleetCopiesValue',
        params: { copies: replication.copies, required: replication.required },
      }
    : { key: 'fleetCopiesNone', params: {} };
}

export function gatewaysLine(topology: SiteTopology): Line | null {
  const active = topology.gateways.filter((gateway) => gateway.active).length;
  return topology.gateways.length ? { key: 'fleetGatewaysValue', params: { active } } : null;
}

/** Mirrors: how many, how many stopped, or how far the furthest one is behind its source. */
export function mirrorsLine(topology: SiteTopology): Line {
  const mirrors = topology.mirrors;
  if (mirrors.length === 0) return { key: 'fleetMirrorsNone', params: {} };
  const failing = mirrors.filter((mirror) => mirror.errorCode !== null).length;
  if (failing) return { key: 'fleetMirrorsFailing', params: { count: mirrors.length, failing } };
  const lag = mirrors.reduce(
    (most, mirror) =>
      mirror.lagChanges && BigInt(mirror.lagChanges) > most ? BigInt(mirror.lagChanges) : most,
    0n,
  );
  return lag > 0n
    ? { key: 'fleetMirrorsBehind', params: { count: mirrors.length, lag: lag.toString() } }
    : { key: 'fleetMirrorsCurrent', params: { count: mirrors.length } };
}

export function queueLine(topology: SiteTopology): Line {
  const queue = topology.downloads;
  return queue.strategy === 'shared'
    ? { key: 'fleetQueueShared', params: {} }
    : { key: 'fleetQueueValue', params: { active: queue.active, waiting: queue.waiting } };
}

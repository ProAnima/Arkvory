import { record } from '@proanima/arkvory-contracts';
import { ArkvoryClientError } from './transfer.js';
import type { HttpPort } from './http-transport.js';

/** A DRBD peer of the node that serves (ADR 0072). */
export interface ReplicationPeer {
  readonly name: string;
  readonly connected: boolean;
  /** DRBD's disk state, e.g. UpToDate, Inconsistent, Diskless, DUnknown. */
  readonly disk: string;
  /** Holds every acknowledged write. */
  readonly complete: boolean;
  /** The diskless tiebreaker of ha-2: a vote, no copy. */
  readonly witness: boolean;
}
export interface ReplicationCopies {
  readonly copies: number;
  readonly required: number;
  /** An operator allowed writes with fewer copies until then (ADR 0072). */
  readonly singleCopyUntil: string | null;
  /** The node that serves, its profile and its peers; null from a server of an earlier release. */
  readonly cluster: {
    readonly node: string;
    readonly profile: 'ha-2' | 'ha-3';
    readonly peers: readonly ReplicationPeer[];
  } | null;
}

/**
 * Copies of an HA cluster (ADR 0072) as readiness reports them. `standalone` has no replica;
 * `unknown` means the cluster could not read its copies, so writes are not acknowledged.
 */
export type Replication =
  | { readonly kind: 'standalone' }
  | { readonly kind: 'unknown' }
  | ({ readonly kind: 'known' } & ReplicationCopies);

const count = (value: unknown, minimum: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 16)
    throw new ArkvoryClientError('invalid_response', 'Invalid replication state');
  return value;
};

const invalid = () => new ArkvoryClientError('invalid_response', 'Invalid replication state');

function readPeer(value: unknown): ReplicationPeer {
  const p = record(value);
  const { name, connected, disk, complete, witness } = p;
  if (
    typeof name !== 'string' ||
    typeof connected !== 'boolean' ||
    typeof disk !== 'string' ||
    typeof complete !== 'boolean' ||
    typeof witness !== 'boolean'
  )
    throw invalid();
  return { name, connected, disk, complete, witness };
}

function readCluster(r: Record<string, unknown>): ReplicationCopies['cluster'] {
  const { node, profile, peers } = r;
  if (node === undefined) return null;
  if (
    typeof node !== 'string' ||
    (profile !== 'ha-2' && profile !== 'ha-3') ||
    !Array.isArray(peers)
  )
    throw invalid();
  return { node, profile, peers: (peers as readonly unknown[]).map(readPeer) };
}

export function readReplication(value: unknown): Replication {
  if (value === undefined) return { kind: 'standalone' };
  if (value === null) return { kind: 'unknown' };
  const r = record(value);
  const until = r['singleCopyUntil'];
  if (until !== null && (typeof until !== 'string' || Number.isNaN(Date.parse(until))))
    throw new ArkvoryClientError('invalid_response', 'Invalid replication state');
  return {
    kind: 'known',
    copies: count(r['copies'], 0),
    required: count(r['required'], 1),
    singleCopyUntil: until,
    cluster: readCluster(r),
  };
}

export class ReplicationApi {
  constructor(private readonly http: HttpPort) {}
  async state(signal?: AbortSignal): Promise<Replication> {
    const ready = record(await this.http.call('/health/ready', 'GET', undefined, signal));
    return readReplication(ready['replication']);
  }
}

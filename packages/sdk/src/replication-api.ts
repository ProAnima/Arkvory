import { record } from '@proanima/arkvory-contracts';
import { ArkvoryClientError } from './transfer.js';
import type { HttpPort } from './http-transport.js';

export interface ReplicationCopies {
  readonly copies: number;
  readonly required: number;
  /** An operator allowed writes with fewer copies until then (ADR 0072). */
  readonly singleCopyUntil: string | null;
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
  };
}

export class ReplicationApi {
  constructor(private readonly http: HttpPort) {}
  async state(signal?: AbortSignal): Promise<Replication> {
    const ready = record(await this.http.call('/health/ready', 'GET', undefined, signal));
    return readReplication(ready['replication']);
  }
}

import { request } from 'node:http';
import type { ReplicaCopies, ReplicaPeer } from '@proanima/arkvory-domain';
import type { ReplicaState } from '@proanima/arkvory-application';

/** More than enough for one local answer; a slower helper means the state is unknown. */
const TIMEOUT_MS = 2000;
const MAX_BODY = 8192;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function peer(value: unknown): ReplicaPeer {
  if (typeof value !== 'object' || value === null) throw new Error('Replica peer is invalid');
  const { name, connected, disk, complete, witness } = value as Record<string, unknown>;
  if (
    typeof name !== 'string' ||
    !NAME.test(name) ||
    typeof connected !== 'boolean' ||
    typeof disk !== 'string' ||
    !/^[A-Za-z]{1,24}$/.test(disk) ||
    typeof complete !== 'boolean' ||
    typeof witness !== 'boolean'
  )
    throw new Error('Replica peer is invalid');
  return { name, connected, disk, complete, witness };
}

/**
 * The optional details of a cluster helper of this release, for the console only: earlier
 * helpers send none, and details that do not parse (a 64-character host name, a peer without a
 * name) are left out rather than turning the copies, which gate writes, into an unknown state.
 */
function details(value: Record<string, unknown>): Partial<ReplicaCopies> {
  const { node, profile, peers } = value;
  if (
    typeof node !== 'string' ||
    !NAME.test(node) ||
    (profile !== 'ha-2' && profile !== 'ha-3') ||
    !Array.isArray(peers) ||
    peers.length > MAX_COPIES
  )
    return {};
  try {
    return { node, profile, peers: peers.map(peer) };
  } catch {
    return {};
  }
}
const MAX_COPIES = 16;

const count = (value: unknown, minimum: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= MAX_COPIES;

/** The helper's answer, checked: anything else is not a state the server may act on. */
export function parseReplicaCopies(value: unknown): ReplicaCopies {
  if (typeof value !== 'object' || value === null)
    throw new Error('Replica state is not an object');
  const { copies, required, singleCopyUntil } = value as Record<string, unknown>;
  if (!count(copies, 0) || !count(required, 1)) throw new Error('Replica copies out of range');
  if (
    singleCopyUntil !== null &&
    (typeof singleCopyUntil !== 'string' || Number.isNaN(Date.parse(singleCopyUntil)))
  )
    throw new Error('Replica decision time is invalid');
  return {
    copies: copies as number,
    required: required as number,
    singleCopyUntil,
    ...details(value as Record<string, unknown>),
  };
}

/**
 * The `arkvory-replica` helper of a cluster node (ADR 0072): `GET /state` over a local socket
 * (a Unix socket, or a named pipe in tests). The helper reads the kernel's state after the
 * request arrives, so the answer is never older than the call.
 */
export class SocketReplicaState implements ReplicaState {
  constructor(private readonly socketPath: string) {}

  read(): Promise<ReplicaCopies> {
    return new Promise((resolve, reject) => {
      const call = request(
        {
          socketPath: this.socketPath,
          path: '/state',
          method: 'GET',
          timeout: TIMEOUT_MS,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > MAX_BODY) call.destroy(new Error('Replica state is too large'));
          });
          response.on('end', () => {
            try {
              if (response.statusCode !== 200)
                throw new Error(`Replica helper answered ${String(response.statusCode)}`);
              resolve(parseReplicaCopies(JSON.parse(body) as unknown));
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
          response.on('error', reject);
        },
      );
      call.on('timeout', () => call.destroy(new Error('Replica helper did not answer')));
      call.on('error', reject);
      call.end();
    });
  }
}

import { request } from 'node:http';
import type { ReplicaCopies } from '@proanima/arkvory-domain';
import type { ReplicaState } from '@proanima/arkvory-application';

/** More than enough for one local answer; a slower helper means the state is unknown. */
const TIMEOUT_MS = 2000;
const MAX_BODY = 4096;
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
  return { copies: copies as number, required: required as number, singleCopyUntil };
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

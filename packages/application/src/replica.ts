import type { ReplicaCopies } from '@proanima/arkvory-domain';

/**
 * The copies of the cluster volume as the kernel reports them (ADR 0072). Each call reads state
 * that is at least as new as the call itself: an answer to `read` started after a write
 * completed tells whether that write is in enough copies. A failure or a timeout rejects; the
 * caller then treats the write as not acknowledged. The adapter bounds the wait itself.
 */
export interface ReplicaState {
  read(): Promise<ReplicaCopies>;
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, acknowledges } from '@proanima/arkvory-domain';
import type { ReplicaCopies } from '@proanima/arkvory-domain';
import type { ReplicaState } from '@proanima/arkvory-application';
import { SocketReplicaState } from '@proanima/arkvory-infrastructure';
import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';
import { lfsPrefix } from './lfs-errors.js';

/** A refused write may come back once a copy has returned; resynchronization takes a while. */
const RETRY_SECONDS = 5;
/** How old a snapshot may be for the early refusal; the decision after a write is never cached. */
const SNAPSHOT_MS = 1000;
/** The one read that acknowledges a write by contract: a completed job publishes the upload. */
const JOB_ROUTE = '/api/v1/jobs/:id';
/**
 * Mutations that acknowledge nothing a client relies on (ADR 0072): a session is not data,
 * feedback is needed during an incident, and a Git LFS batch request also serves downloads (the
 * object upload itself is checked).
 */
const EXEMPT = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/feedback',
  `${lfsPrefix}objects/batch`,
]);

export function acknowledging(request: FastifyRequest): boolean {
  if (request.is404) return false;
  const route = request.routeOptions.url ?? '';
  if (request.method === 'GET' || request.method === 'HEAD') return route === JOB_ROUTE;
  if (request.method === 'OPTIONS' || route.startsWith('/health/')) return false;
  return !EXEMPT.has(route);
}

const degraded = (state: ReplicaCopies | undefined) =>
  new ArkvoryError(
    'unavailable',
    state
      ? `Only ${String(state.copies)} of ${String(state.required)} required copies are complete`
      : 'The cluster cannot tell how many copies are complete',
    { reason: 'replication_degraded', retryAfterSeconds: RETRY_SECONDS },
  );

/**
 * The acknowledgment rule of an HA cluster (ADR 0072): a write is answered with success only if,
 * read after it completed, enough complete copies of the volume exist. Refused early from a
 * recent snapshot, and decided after the write from a fresh read; an unknown state refuses.
 */
export class ReplicaGuard {
  private last: { at: number; state: ReplicaCopies | undefined } | undefined;
  private reading: Promise<ReplicaCopies | undefined> | undefined;
  private refused = 0;
  private failures = 0;

  constructor(
    private readonly state: ReplicaState,
    private readonly now: () => number,
  ) {}

  /** The latest known copies, for readiness and metrics; undefined while unknown. */
  get snapshot(): ReplicaCopies | undefined {
    return this.last?.state;
  }

  private async fresh(): Promise<ReplicaCopies | undefined> {
    try {
      const state = await this.state.read();
      this.last = { at: this.now(), state };
      return state;
    } catch {
      this.failures++;
      this.last = { at: this.now(), state: undefined };
      return undefined;
    }
  }

  private recent(): Promise<ReplicaCopies | undefined> {
    if (this.last && this.now() - this.last.at < SNAPSHOT_MS)
      return Promise.resolve(this.last.state);
    this.reading ??= this.fresh().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  /** Before a write: refuse at once when copies are already missing. */
  async before(): Promise<void> {
    const state = await this.recent();
    if (!state || !acknowledges(state)) {
      this.refused++;
      throw degraded(state);
    }
  }

  /** After a write completed, before its success is sent: a read started now, never cached. */
  async after(): Promise<void> {
    const state = await this.fresh();
    if (!state || !acknowledges(state)) {
      this.refused++;
      throw degraded(state);
    }
  }

  refresh(): Promise<void> {
    return this.recent().then(() => undefined);
  }

  register(registry: MetricsRegistry): void {
    const value = (
      name: string,
      help: string,
      type: 'gauge' | 'counter',
      read: () => number | undefined,
    ) => {
      registry.sampled({
        name,
        help,
        type,
        labels: [],
        collect: () => {
          const measured = read();
          return measured === undefined ? [] : [{ labels: {}, value: measured }];
        },
      });
    };
    value(
      'arkvory_replication_copies',
      'Complete copies of the cluster volume.',
      'gauge',
      () => this.snapshot?.copies,
    );
    value(
      'arkvory_replication_required_copies',
      'Copies a write needs before it is acknowledged.',
      'gauge',
      () => this.snapshot?.required,
    );
    value(
      'arkvory_replication_writes_refused_total',
      'Writes answered 503 replication_degraded.',
      'counter',
      () => this.refused,
    );
    value(
      'arkvory_replication_check_failures_total',
      'Reads of the copies that failed or timed out.',
      'counter',
      () => this.failures,
    );
  }
}

/** A read gateway refuses every write anyway; only the writer checks copies (ADR 0072). */
export function replicaGuardFor(socket: string | undefined, role: 'api' | 'reader') {
  return socket && role === 'api'
    ? new ReplicaGuard(new SocketReplicaState(socket), () => performance.now())
    : undefined;
}

/** Without a replica helper (standalone) there is one copy by design and nothing to check. */
export function registerReplicaGuard(app: FastifyInstance, guard: ReplicaGuard | undefined): void {
  if (!guard) return;
  app.addHook('onRequest', async (request) => {
    if (acknowledging(request) && request.method !== 'GET') await guard.before();
  });
  // A failure thrown here reaches the route's own error handler, so the registry, Git LFS and
  // npm answer in their own formats; the error response itself is not 2xx and passes through.
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode >= 200 && reply.statusCode < 300 && acknowledging(request))
      await guard.after();
    return payload;
  });
}

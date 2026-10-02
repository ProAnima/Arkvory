import {
  BackupFailure,
  MAX_REQUEST_ATTEMPTS,
  requestRetry,
  scheduleDecision,
} from '@proanima/arkvory-domain';
import type { BackupFailureCode, VerifyDepth } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import { backupFailureOf } from './backup-capture.js';
import { VerifyPoint } from './backup-verify.js';
import { ApplyBackupRetention, anyCancellation, syncCatalog } from './backup-retention-apply.js';
import type {
  AgentCatalog,
  AgentEvent,
  AgentLease,
  AgentPlan,
  AgentQueue,
  CaptureRunner,
  ClaimedRequest,
  MaintainedVault,
  VaultLock,
} from './backup-agent-ports.js';

export interface BackupAgentDependencies {
  readonly queue: AgentQueue;
  readonly plan: AgentPlan;
  readonly catalog: AgentCatalog;
  /** Null while ARKVORY_BACKUP_VAULT is not configured: requests then fail `vault_missing`. */
  readonly vault: MaintainedVault | null;
  readonly lock: VaultLock;
  readonly capture: CaptureRunner;
  readonly sourceInstanceId: string;
  /** Milliseconds since the epoch; the schedule and deep-verify cadence use only this clock. */
  readonly clock: () => number;
  readonly next: () => string;
  /** Deep verification of the newest point happens at most this often (default weekly). */
  readonly deepVerifyMs?: number;
  readonly events?: (event: AgentEvent) => void;
}
export type StepOutcome = 'worked' | 'idle';
const WEEK = 7 * 86_400_000;
/** Progress rows are rewritten at most this often while bytes are verified. */
const progressIntervalMs = 1000;

/**
 * Writes issued from synchronous progress callbacks: they run in order, a failure is kept
 * instead of becoming an unhandled rejection and surfaces once the operation settles.
 */
class SerialWrites {
  private tail: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  add(write: () => Promise<void>): void {
    this.tail = this.tail.then(write).catch((error: unknown) => {
      this.failure ??= { error };
    });
  }
  /** Awaits the operation, then every write issued so far; the first failure wins. */
  async settleAfter<T>(operation: Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation;
    } catch (error) {
      await this.tail;
      throw error;
    }
    await this.tail;
    if (this.failure) throw this.failure.error;
    return result;
  }
}

/**
 * One supervised agent (ADR 0056). step() performs at most one unit of work: a queued request,
 * otherwise the due scheduled capture, otherwise the weekly deep verification. Requests run
 * one at a time under the agent lease; a successful capture queues its structural
 * verification and then retention, each as a job of its own.
 */
export class BackupAgent {
  private readonly retention: ApplyBackupRetention | null;
  constructor(private readonly deps: BackupAgentDependencies) {
    const { vault, catalog, plan, lock, sourceInstanceId } = deps;
    this.retention = vault
      ? new ApplyBackupRetention({ vault, catalog, plan, lock, sourceInstanceId })
      : null;
  }

  /** Rebuilds the catalog from the vault at start; the vault stays the source of truth. */
  async reconcile(lease: AgentLease, cancellation: Cancellation): Promise<void> {
    const vault = this.deps.vault;
    if (!vault) return;
    const synced = await this.deps.lock.shared(async (held) =>
      syncCatalog(
        { vault, catalog: this.deps.catalog, sourceInstanceId: this.deps.sourceInstanceId },
        lease,
        await vault.listing(),
        anyCancellation(cancellation, held),
      ),
    );
    this.deps.events?.({ code: 'catalog.reconciled', ...synced });
  }

  async step(lease: AgentLease, cancellation: Cancellation): Promise<StepOutcome> {
    lease.throwIfAborted();
    const request = await this.deps.queue.claim(lease);
    if (request) return this.execute(lease, request, anyCancellation(cancellation, lease));
    if (!this.deps.vault) return 'idle';
    if (await this.schedule(lease)) return 'worked';
    return (await this.deepVerify(lease)) ? 'worked' : 'idle';
  }

  private async schedule(lease: AgentLease): Promise<boolean> {
    const plan = await this.deps.plan.read();
    const { due } = scheduleDecision(plan, plan, this.deps.clock());
    if (due === null) return false;
    const id = this.deps.next();
    const key = `schedule:${new Date(due).toISOString()}`;
    if (!(await this.deps.plan.consume(lease, due, { id, key, revision: plan.revision })))
      return false;
    this.deps.events?.({ code: 'schedule.due', slot: due, id });
    return true;
  }

  private async deepVerify(lease: AgentLease): Promise<boolean> {
    // An unmounted vault is reported by the heartbeat; it is no reason to fail every poll.
    const identity = await this.requireVault()
      .identity()
      .catch(() => null);
    if (!identity) return false;
    const live = await this.deps.catalog.live(identity.vaultId);
    const newest = live.reduce<(typeof live)[number] | undefined>(
      (best, point) => (!best || point.snapshotAt > best.snapshotAt ? point : best),
      undefined,
    );
    if (!newest) return false;
    const period = this.deps.deepVerifyMs ?? WEEK;
    const now = this.deps.clock();
    const last = Math.max(...live.map((point) => point.deepVerifiedAt ?? Number.NEGATIVE_INFINITY));
    if (now - last < period) return false;
    // One key per point and period: a failed attempt waits for the next period.
    return this.deps.queue.followUp(lease, {
      id: this.deps.next(),
      kind: 'verify',
      pointId: newest.id,
      depth: 'deep',
      key: `deep:${newest.id}:${String(Math.floor(now / period))}`,
    });
  }

  private async execute(
    lease: AgentLease,
    request: ClaimedRequest,
    cancellation: Cancellation,
  ): Promise<StepOutcome> {
    const { queue, events } = this.deps;
    // A request whose agent kept dying with it (crash, kill) stops being retried.
    if (request.attempts > MAX_REQUEST_ATTEMPTS) {
      await queue.finish(lease, request.id, {
        failed: 'attempts_exhausted',
        pointId: request.pointId,
      });
      events?.({
        code: 'request.failed',
        id: request.id,
        kind: request.kind,
        errorCode: 'attempts_exhausted',
      });
      return 'worked';
    }
    events?.({ code: 'request.started', id: request.id, kind: request.kind });
    try {
      const pointId = await this.perform(lease, request, cancellation);
      await queue.finish(lease, request.id, { failed: null, pointId });
      events?.({ code: 'request.done', id: request.id, kind: request.kind, pointId });
      return 'worked';
    } catch (error) {
      const failure = backupFailureOf(error);
      // Without the lease nothing may be written; the next owner reclaims the request.
      if (!lease.active) throw failure;
      const retry = requestRetry(failure.code, request.attempts);
      const code: BackupFailureCode = failure.code;
      if (retry === 'requeue') {
        await queue.requeue(lease, request.id);
        events?.({
          code: 'request.requeued',
          id: request.id,
          kind: request.kind,
          errorCode: code,
          cause: error,
        });
        // Wait one poll before the retry: contention and shutdown are not resolved instantly.
        return 'idle';
      }
      await queue.finish(lease, request.id, { failed: code, pointId: request.pointId });
      events?.({
        code: 'request.failed',
        id: request.id,
        kind: request.kind,
        errorCode: code,
        cause: error,
      });
      return 'worked';
    }
  }

  /** Runs one request; returns the point it produced or checked. */
  private async perform(
    lease: AgentLease,
    request: ClaimedRequest,
    cancellation: Cancellation,
  ): Promise<string | null> {
    switch (request.kind) {
      case 'capture':
        return this.capture(lease, request, cancellation);
      case 'verify':
        if (request.pointId === null)
          throw new BackupFailure('invalid_argument', 'Verify request names no point');
        await this.verify(lease, request.id, request.pointId, request.depth, cancellation);
        return request.pointId;
      case 'retention': {
        if (!this.retention) throw this.missingVault();
        const outcome = await this.retention.run(lease, cancellation);
        const bytes = BigInt(outcome.bytes);
        await this.deps.queue.progress(lease, request.id, {
          phase: 'done',
          bytesDone: bytes,
          bytesTotal: bytes,
          blobsDone: outcome.blobs,
          blobsTotal: outcome.blobs,
        });
        this.deps.events?.({ code: 'retention.applied', ...outcome });
        return null;
      }
    }
  }

  private async capture(
    lease: AgentLease,
    request: ClaimedRequest,
    cancellation: Cancellation,
  ): Promise<string> {
    const vault = this.requireVault();
    const writes = new SerialWrites();
    let linked: string | undefined;
    const result = await writes.settleAfter(
      this.deps.capture.run(
        `request:${request.id}`,
        (jobId) => {
          if (jobId === linked) return;
          linked = jobId;
          writes.add(() => this.deps.queue.attach(lease, request.id, jobId));
        },
        cancellation,
      ),
    );
    const manifest = await vault.point(result.pointId);
    if (!manifest) throw new BackupFailure('point_not_found', 'Captured point is not in vault');
    await this.deps.catalog.record(lease, { manifest, newBytes: result.copiedBytes });
    for (const kind of ['verify', 'retention'] as const)
      await this.deps.queue.followUp(lease, {
        id: this.deps.next(),
        kind,
        pointId: kind === 'verify' ? result.pointId : null,
        depth: kind === 'verify' ? 'structural' : null,
        key: `after-capture:${result.pointId}`,
      });
    return result.pointId;
  }

  private async verify(
    lease: AgentLease,
    requestId: string,
    pointId: string,
    depth: VerifyDepth | null,
    cancellation: Cancellation,
  ): Promise<void> {
    const vault = this.requireVault();
    const deep = depth === 'deep';
    const manifest = await vault.point(pointId);
    if (!manifest) throw new BackupFailure('point_not_found', 'No committed point with this id');
    const totals = {
      bytesTotal: BigInt(manifest.inventory.contentBytes),
      blobsTotal: manifest.inventory.count,
    };
    let reported = Number.NEGATIVE_INFINITY;
    const writes = new SerialWrites();
    const report = (blobs: number, bytes: bigint) => {
      const phase = deep ? 'deep' : 'structural';
      writes.add(() =>
        this.deps.queue.progress(lease, requestId, {
          phase,
          bytesDone: bytes,
          blobsDone: blobs,
          ...totals,
        }),
      );
    };
    const result = await writes.settleAfter(
      this.deps.lock.shared((held) =>
        new VerifyPoint(vault, {
          progress: ({ blobs, bytes }) => {
            const now = this.deps.clock();
            if (now - reported < progressIntervalMs) return;
            reported = now;
            report(blobs, bytes);
          },
        }).verify(manifest, deep, anyCancellation(cancellation, held)),
      ),
    );
    report(result.blobs, totals.bytesTotal);
    await writes.settleAfter(Promise.resolve());
    const error = result.ok ? null : (result.problems[0]?.code ?? 'manifest_invalid');
    await this.deps.catalog.verified(lease, pointId, {
      depth: deep ? 'deep' : 'structural',
      error,
    });
    if (!result.ok) throw new BackupFailure('integrity_mismatch', 'Point failed verification');
  }

  private requireVault(): MaintainedVault {
    if (!this.deps.vault) throw this.missingVault();
    return this.deps.vault;
  }

  private missingVault(): BackupFailure {
    return new BackupFailure('vault_missing', 'ARKVORY_BACKUP_VAULT is not configured');
  }
}

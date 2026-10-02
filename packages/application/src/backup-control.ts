import {
  ArkvoryError,
  agentOnline,
  backupWarnings,
  parseBackupPlanUpdate,
  parsePinUpdate,
  planRetention,
  requireBackupPermission,
  requireBackupRequestKey,
  requireId,
  scheduleDecision,
  withField,
} from '@proanima/arkvory-domain';
import type {
  BackupRequestKind,
  BackupWarning,
  Principal,
  RetentionPlan,
  VerifyDepth,
} from '@proanima/arkvory-domain';
import type {
  BackupJobLog,
  BackupJobRecord,
  BackupPlanStore,
  BackupPointCatalog,
  BackupPointRecord,
  BackupRequestQueue,
  BackupRequestReceipt,
  BackupStatusSnapshot,
  BackupStatusSource,
  BackupPage,
  BackupPageQuery,
  StoredBackupPlan,
} from './backup-control-ports.js';

export interface BackupStatusView {
  readonly vault: {
    readonly configured: boolean;
    readonly id: string | null;
    readonly available: boolean;
    readonly freeBytes: string | null;
    readonly totalBytes: string | null;
  };
  readonly agent: {
    readonly online: boolean;
    readonly lastSeenAt: number | null;
    readonly version: string | null;
  };
  readonly plan: StoredBackupPlan;
  readonly lastCompleted: BackupPointRecord | null;
  readonly nextRunAt: number | null;
  readonly running: BackupJobRecord | null;
  readonly warnings: readonly BackupWarning[];
}

/**
 * Status and warnings of one snapshot; pure, shared by the API and its metrics. Vault facts are
 * the agent's: while it is offline the vault is reported unavailable rather than guessed.
 */
export function evaluateBackupStatus(snapshot: BackupStatusSnapshot): BackupStatusView {
  const { agent, plan, newest, now } = snapshot;
  // A stopped agent released its lease: offline at once, not only after the heartbeat ages.
  const seenAt = agent?.active === true ? agent.seenAt : null;
  const online = agentOnline({ now, agentSeenAt: seenAt });
  const freeBytes = agent?.freeBytes ?? null;
  const totalBytes = agent?.totalBytes ?? null;
  const warnings = backupWarnings({
    now,
    agentSeenAt: seenAt,
    vault: {
      configured: agent?.vaultConfigured === true,
      available: agent?.vaultAvailable === true,
      freeBytes: freeBytes === null ? null : BigInt(freeBytes),
      totalBytes: totalBytes === null ? null : BigInt(totalBytes),
    },
    scheduleEnabled: plan.enabled,
    newest: newest ? { snapshotAt: newest.snapshotAt, newBytes: BigInt(newest.newBytes) } : null,
    lastCaptureFailed: snapshot.lastCaptureFailed,
    verifyFailed: snapshot.verifyFailed,
    lastDeepVerifiedAt: snapshot.lastDeepVerifiedAt,
  });
  return {
    vault: {
      configured: agent?.vaultConfigured === true,
      id: agent?.vaultId ?? null,
      available: online && agent?.vaultAvailable === true,
      freeBytes,
      totalBytes,
    },
    agent: { online, lastSeenAt: agent?.seenAt ?? null, version: agent?.version ?? null },
    plan,
    lastCompleted: newest,
    nextRunAt: scheduleDecision(plan, plan, now).nextRunAt,
    running: snapshot.running,
    warnings,
  };
}

const cursorPattern = /^[0-9]{1,17}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Query of GET /backup/jobs and /backup/points: optional opaque cursor, limit 1-100 (50). */
export function backupPageQuery(query: { after?: unknown; limit?: unknown }): BackupPageQuery {
  const { after, limit } = query;
  if (after !== undefined && (typeof after !== 'string' || !cursorPattern.test(after)))
    throw new ArkvoryError('invalid_input', 'Invalid page cursor', {
      reason: 'validation',
      details: [{ field: 'after', problem: 'format' }],
    });
  if (
    limit !== undefined &&
    (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)
  )
    throw new ArkvoryError('invalid_input', 'Invalid page limit', {
      reason: 'validation',
      details: [{ field: 'limit', problem: 'range' }],
    });
  return { limit: limit === undefined ? 50 : Number(limit), ...(after ? { after } : {}) };
}

export interface BackupControlDependencies {
  readonly status: BackupStatusSource;
  readonly plans: BackupPlanStore;
  readonly requests: BackupRequestQueue;
  readonly jobs: BackupJobLog;
  readonly catalog: BackupPointCatalog;
  readonly next: () => string;
}

/**
 * Control plane of unattended backups (ADR 0056): authorizes system permissions, validates
 * input and queues typed requests for the agent. It never executes a backup itself.
 */
export class BackupControl {
  constructor(private readonly deps: BackupControlDependencies) {}

  async status(principal: Principal): Promise<BackupStatusView> {
    requireBackupPermission(principal, 'backup.read');
    return evaluateBackupStatus(await this.deps.status.snapshot());
  }

  async plan(principal: Principal): Promise<StoredBackupPlan> {
    requireBackupPermission(principal, 'backup.read');
    return this.deps.plans.read();
  }

  async updatePlan(principal: Principal, body: unknown): Promise<StoredBackupPlan> {
    requireBackupPermission(principal, 'backup.manage');
    return this.deps.plans.save(parseBackupPlanUpdate(body), principal.id);
  }

  run(principal: Principal, key: unknown): Promise<BackupRequestReceipt> {
    return this.request(principal, 'capture', key, null, null);
  }

  async verify(principal: Principal, pointId: string, key: unknown) {
    requireBackupPermission(principal, 'backup.manage');
    const id = withField('id', () => requireId(pointId));
    const vault = await this.deps.status.currentVault();
    if (!vault || !(await this.deps.catalog.point(vault, id)))
      throw new ArkvoryError('not_found', 'Backup point not found');
    // A verification an operator asks for reads every byte; capture already checks structure.
    return this.request(principal, 'verify', key, id, 'deep');
  }

  applyRetention(principal: Principal, key: unknown): Promise<BackupRequestReceipt> {
    return this.request(principal, 'retention', key, null, null);
  }

  async jobs(principal: Principal, query: BackupPageQuery): Promise<BackupPage<BackupJobRecord>> {
    requireBackupPermission(principal, 'backup.read');
    return this.deps.jobs.jobs(query);
  }

  async points(
    principal: Principal,
    query: BackupPageQuery,
  ): Promise<BackupPage<BackupPointRecord>> {
    requireBackupPermission(principal, 'backup.read');
    const vault = await this.deps.status.currentVault();
    return vault ? this.deps.catalog.points(vault, query) : { items: [], next: null };
  }

  async pin(principal: Principal, pointId: string, body: unknown): Promise<BackupPointRecord> {
    requireBackupPermission(principal, 'backup.manage');
    const id = withField('id', () => requireId(pointId));
    const pinned = parsePinUpdate(body);
    const vault = await this.deps.status.currentVault();
    const point = vault ? await this.deps.catalog.pin(vault, id, pinned) : null;
    if (!point) throw new ArkvoryError('not_found', 'Backup point not found');
    return point;
  }

  /** The plan apply would follow now; points that failed verification are not candidates. */
  async retentionPreview(principal: Principal): Promise<RetentionPlan> {
    requireBackupPermission(principal, 'backup.read');
    const [vault, plan] = await Promise.all([
      this.deps.status.currentVault(),
      this.deps.plans.read(),
    ]);
    if (!vault) return { keep: [], delete: [] };
    const points = (await this.deps.catalog.live(vault)).filter(
      (point) => point.verifyError === null,
    );
    return planRetention(points, plan.retention, plan.timezone);
  }

  private async request(
    principal: Principal,
    kind: BackupRequestKind,
    key: unknown,
    pointId: string | null,
    depth: VerifyDepth | null,
  ): Promise<BackupRequestReceipt> {
    requireBackupPermission(principal, 'backup.manage');
    return this.deps.requests.enqueue({
      id: this.deps.next(),
      kind,
      pointId,
      depth,
      idempotencyKey: requireBackupRequestKey(key),
      requestedBy: principal.id,
      requestId: principal.requestId ?? null,
    });
  }
}

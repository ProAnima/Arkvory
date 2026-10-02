import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BackupFailure } from '@proanima/arkvory-domain';
import {
  BackupAgent,
  CaptureBackup,
  anyCancellation,
  backupFailureOf,
} from '@proanima/arkvory-application';
import type {
  AgentEvent,
  AgentLease,
  Cancellation,
  CaptureRunner,
  StepOutcome,
} from '@proanima/arkvory-application';
import {
  FileVault,
  LocalBlobStore,
  PostgresAgentLease,
  PostgresBackupCatalog,
  PostgresBackupPlan,
  PostgresBackupRequests,
  PostgresVaultLock,
  SCHEMA_VERSION,
  appliedSchemaVersion,
  backupPool,
  failureCause,
  redactDiagnostic,
  requireSeparateTrees,
} from '@proanima/arkvory-infrastructure';
import type {
  BackupPool,
  DiagnosticLogger,
  DiagnosticRecord,
} from '@proanima/arkvory-infrastructure';
import type { AgentConfig } from './config.js';
import { captureDependencies, openCaptureSource } from './source.js';
import { captureObserver } from './capture-progress.js';
import { VaultProbe } from './agent-probe.js';

type Logger = Pick<DiagnosticLogger, 'write'>;
export interface AgentOptions {
  readonly config: AgentConfig;
  readonly release: { readonly version: string; readonly commit: string | null };
  readonly logger: Logger;
  /** Aborted by SIGTERM/SIGINT: the current phase stops per B1 rules, the lease is released. */
  readonly signal: AbortSignal;
  /** Wall clock of the schedule; tests move it. */
  readonly clock?: () => number;
  readonly owner?: string;
}

function captureRunner(
  config: AgentConfig,
  vault: FileVault,
  release: AgentOptions['release'],
  logger: Logger,
): CaptureRunner {
  return {
    async run(key, started, cancellation) {
      // A source session per capture: offline maintenance may run between backups.
      const source = await openCaptureSource(config.source);
      const observer = captureObserver(source.pool, logger, started);
      try {
        const capture = new CaptureBackup(
          captureDependencies(source, vault, {
            config: config.source,
            release,
            bytesPerSecond: config.bytesPerSecond,
            progress: (event) => {
              observer.record(event);
            },
          }),
        );
        const session: Cancellation = {
          throwIfAborted() {
            if (!source.active())
              throw new BackupFailure('lease_lost', 'Capture session to the database was lost');
          },
        };
        return await capture.run(key, anyCancellation(cancellation, session));
      } finally {
        await observer.flush();
        await source.close();
      }
    },
  };
}

/** Identifiers of the underlying error (name, errno, sqlstate), never its message. */
function causeOf(error: unknown) {
  const failure = backupFailureOf(error);
  return failureCause(failure.cause ?? failure);
}

function eventRecord(event: AgentEvent): DiagnosticRecord {
  const base = { component: 'backup' as const, level: 'info' as const };
  switch (event.code) {
    case 'request.started':
      return { ...base, code: 'backup.request.started', jobId: event.id, kind: event.kind };
    case 'request.done':
      return {
        ...base,
        code: 'backup.request.done',
        jobId: event.id,
        kind: event.kind,
        ...(event.pointId ? { pointId: event.pointId } : {}),
      };
    case 'request.failed':
    case 'request.requeued':
      return {
        ...base,
        level: event.code === 'request.failed' ? 'error' : 'warning',
        code: `backup.${event.code}`,
        jobId: event.id,
        kind: event.kind,
        errorCode: event.errorCode,
        ...(event.cause === undefined ? {} : causeOf(event.cause)),
      };
    case 'schedule.due':
      return {
        ...base,
        code: 'backup.schedule.due',
        jobId: event.id,
        slotAt: new Date(event.slot).toISOString(),
      };
    case 'retention.applied':
      return {
        ...base,
        code: 'backup.retention.applied',
        forgotten: event.forgotten,
        blobs: event.blobs,
        freedBytes: event.bytes,
      };
    case 'catalog.reconciled':
      return {
        ...base,
        code: 'backup.catalog.reconciled',
        points: event.points,
        damaged: event.damaged,
      };
  }
}

/** Storage id of the source: points of other instances in a shared vault are never touched. */
async function sourceInstance(config: AgentConfig): Promise<string> {
  const blobs = new LocalBlobStore(config.source.dataDirectory, config.source.reserveBytes);
  try {
    await blobs.ready();
    return await blobs.identity(true);
  } catch (error) {
    throw new BackupFailure('storage_mismatch', 'ARKVORY_DATA_DIR is not an initialized storage', {
      cause: error,
    });
  }
}

/** Opens without reading vault.json: an unmounted vault is reported, not fatal at start. */
async function agentVault(config: AgentConfig): Promise<FileVault | null> {
  if (config.vault === null) return null;
  const vault = await FileVault.open(config.vault);
  await requireSeparateTrees(
    { label: 'vault', path: vault.root },
    { label: 'storage root', path: config.source.dataDirectory },
  );
  return vault;
}

/** Read through a call: the flag changes asynchronously, outside of narrowing. */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal }).catch(() => undefined);
}

/**
 * The supervised agent process (ADR 0056): standby until it holds the database lease, then one
 * unit of work at a time. Losing the lease stops the work and returns to standby; a signal
 * interrupts the current phase (the request is queued again) and releases the lease.
 */
export async function runAgent(options: AgentOptions): Promise<void> {
  const { config, logger } = options;
  const sourceInstanceId = await sourceInstance(config);
  const vault = await agentVault(config);
  const pool = backupPool(config.source.databaseUrl, 6);
  try {
    if ((await appliedSchemaVersion(pool)) !== SCHEMA_VERSION)
      throw new BackupFailure('schema_mismatch', 'Source schema differs from this release');
    const probe = new VaultProbe(vault);
    const agent = createAgent(pool, vault, sourceInstanceId, options, probe);
    const leases = new PostgresAgentLease(pool, {
      owner: options.owner ?? randomUUID(),
      leaseSeconds: config.source.leaseSeconds,
      version: options.release.version.slice(0, 64),
    });
    logger.write({
      level: 'info',
      component: 'backup',
      code: 'backup.agent.started',
      ...(vault ? {} : { outcome: 'vault_not_configured' }),
    });
    await supervise({ agent, leases, probe }, options);
  } finally {
    await pool.end();
  }
  logger.write({ level: 'info', component: 'backup', code: 'backup.agent.stopped' });
}

function createAgent(
  pool: BackupPool,
  vault: FileVault | null,
  sourceInstanceId: string,
  options: AgentOptions,
  probe: VaultProbe,
): BackupAgent {
  const { config, logger, release } = options;
  return new BackupAgent({
    queue: new PostgresBackupRequests(pool),
    plan: new PostgresBackupPlan(pool),
    catalog: new PostgresBackupCatalog(pool),
    vault,
    lock: new PostgresVaultLock(pool),
    capture: vault
      ? captureRunner(config, vault, release, logger)
      : {
          run: () => Promise.reject(new BackupFailure('vault_missing', 'No vault is configured')),
        },
    sourceInstanceId,
    clock: options.clock ?? (() => Date.now()),
    next: () => randomUUID(),
    events: (event) => {
      if (event.code === 'request.failed') probe.lastError = event.errorCode;
      if (event.code === 'request.done') probe.lastError = null;
      logger.write(eventRecord(event));
    },
  });
}

/** Messages are constant texts of this code base; causes contribute identifiers only. */
function failed(logger: Logger, probe: VaultProbe, error: unknown): void {
  const failure = backupFailureOf(error);
  probe.lastError = failure.code;
  logger.write({
    level: 'error',
    component: 'backup',
    code: 'backup.agent.failed',
    errorCode: failure.code,
    reason: redactDiagnostic(failure.message),
    ...failureCause(failure.cause ?? failure),
  });
}

interface Supervised {
  readonly agent: BackupAgent;
  readonly leases: PostgresAgentLease;
  readonly probe: VaultProbe;
}

async function supervise(parts: Supervised, options: AgentOptions): Promise<void> {
  const { logger, signal } = options;
  const pollMs = options.config.pollSeconds * 1000;
  let standby = false;
  while (!signal.aborted) {
    let lease: Awaited<ReturnType<PostgresAgentLease['acquire']>>;
    try {
      lease = await parts.leases.acquire(() => parts.probe.facts());
    } catch (error) {
      // The database may be restarting; the service waits instead of exiting.
      failed(logger, parts.probe, error);
      await pause(pollMs, signal);
      continue;
    }
    if (!lease) {
      if (!standby)
        logger.write({ level: 'info', component: 'backup', code: 'backup.agent.standby' });
      standby = true;
      await pause(pollMs, signal);
      continue;
    }
    standby = false;
    logger.write({
      level: 'info',
      component: 'backup',
      code: 'backup.agent.lease_acquired',
      generation: lease.generation,
    });
    try {
      await work(parts, lease, options, pollMs);
    } finally {
      await parts.leases.release(lease).catch((error: unknown) => {
        failed(logger, parts.probe, error);
      });
    }
    // The work loop ends on a signal or on a lost lease; only the latter is reported.
    if (!stopped(signal))
      logger.write({
        level: 'warning',
        component: 'backup',
        code: 'backup.agent.lease_lost',
        generation: lease.generation,
      });
  }
}

async function work(parts: Supervised, lease: AgentLease, options: AgentOptions, pollMs: number) {
  const { signal, logger } = options;
  const stopping: Cancellation = {
    throwIfAborted() {
      if (signal.aborted) throw new BackupFailure('interrupted', 'The backup agent is stopping');
    },
  };
  const report = (error: unknown) => {
    if (!signal.aborted || backupFailureOf(error).code !== 'interrupted')
      failed(logger, parts.probe, error);
  };
  await parts.agent.reconcile(lease, stopping).catch(report);
  while (!signal.aborted && lease.active) {
    let outcome: StepOutcome = 'idle';
    try {
      outcome = await parts.agent.step(lease, stopping);
    } catch (error) {
      report(error);
    }
    if (outcome === 'idle') await pause(pollMs, signal);
  }
}

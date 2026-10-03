import { setTimeout as delay } from 'node:timers/promises';
import type {
  BackupJobResponse,
  BackupPointResponse,
  BackupReceiptResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';
import { isUnconfirmedTermination } from './process.js';

/**
 * A schema-changing update cannot prove a fresh verified backup (ADR 0059). Raised before any
 * service is stopped: the installation is unchanged and the operator chooses the next step.
 */
export class BackupRequired extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(
      `${reason}. A release that changes the database schema installs only after the built-in agent has captured and verified a fresh backup; or take an operator backup and run: arkvory upgrade --backup-record <file>`,
      options,
    );
    this.name = 'BackupRequired';
  }
}

/** The backup API of the running release, called with the file-based bootstrap key. */
export interface BackupControlPort {
  status(): Promise<BackupStatusResponse>;
  run(idempotencyKey: string): Promise<BackupReceiptResponse>;
  /** First page, newest first: a fresh request is on it. */
  jobs(): Promise<readonly BackupJobResponse[]>;
  points(): Promise<readonly BackupPointResponse[]>;
}
export interface BackupGuardWait {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly now: () => number;
  /** Called on every poll: the updater keeps its heartbeat visible during a long capture. */
  readonly beat?: () => Promise<void>;
}
export interface VerifiedBackup {
  readonly pointId: string;
  readonly vaultId: string;
  readonly snapshotAt: string;
}

/** A capture plus its structural verification after the last daily copy: minutes, not hours. */
export const guardWait = { intervalMs: 5000, timeoutMs: 6 * 3600000, now: () => Date.now() };

async function ready(port: BackupControlPort): Promise<string> {
  let status: BackupStatusResponse;
  try {
    status = await port.status();
  } catch (error) {
    if (isUnconfirmedTermination(error)) throw error;
    throw new BackupRequired(
      `The running release does not report backups (${error instanceof Error ? error.message : 'unknown error'})`,
      { cause: error },
    );
  }
  if (!status.vault.configured || status.vault.id === null)
    throw new BackupRequired(
      'No backup vault is configured: arkvory configure --backup-vault <dir> --init-vault',
    );
  if (!status.vault.available) throw new BackupRequired('The backup vault is unavailable');
  if (!status.agent.online) throw new BackupRequired('The backup agent is offline');
  // The first full copy of terabytes is a planned operation, never a side effect of an update.
  if (!status.lastCompleted)
    throw new BackupRequired('No backup has completed yet; run the first backup and wait for it');
  return status.vault.id;
}

/** Polls `step` until it yields a value; BackupRequired from `step` is final, other errors retry. */
async function until<T>(wait: BackupGuardWait, what: string, step: () => Promise<T | null>) {
  const deadline = wait.now() + wait.timeoutMs;
  for (let first = true; ; first = false) {
    if (!first) await delay(wait.intervalMs);
    await wait.beat?.();
    try {
      const value = await step();
      if (value !== null) return value;
    } catch (error) {
      if (error instanceof BackupRequired || isUnconfirmedTermination(error)) throw error;
    }
    if (wait.now() >= deadline) throw new BackupRequired(`Timed out waiting for the ${what}`);
  }
}

/**
 * Requests a new capture while every service still runs and waits for its structural
 * verification. Writes accepted after the snapshot and before the stop are not in the point;
 * the point matters only when the new release fails after its migration (ADR 0059).
 */
export async function verifiedBackup(
  port: BackupControlPort,
  idempotencyKey: string,
  wait: BackupGuardWait,
): Promise<VerifiedBackup> {
  const vaultId = await ready(port);
  const receipt = await port.run(idempotencyKey).catch((error: unknown) => {
    if (isUnconfirmedTermination(error)) throw error;
    throw new BackupRequired('The backup request was refused', { cause: error });
  });
  const pointId = await until(wait, 'backup capture', async () => {
    const job = (await port.jobs()).find((entry) => entry.id === receipt.id);
    if (job?.state === 'failed')
      throw new BackupRequired(`The backup capture failed (${job.errorCode ?? 'unknown'})`);
    return job?.state === 'completed' ? job.pointId : null;
  });
  const point = await until(wait, 'backup verification', async () => {
    const found = (await port.points()).find((entry) => entry.id === pointId);
    if (found?.verifyError)
      throw new BackupRequired(`The fresh backup failed verification (${found.verifyError})`);
    return found?.verifiedAt ? found : null;
  });
  return { pointId, vaultId, snapshotAt: point.snapshotAt };
}

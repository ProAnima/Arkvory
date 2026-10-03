import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  readBackupJobPage,
  readBackupPointPage,
  readBackupReceipt,
  readBackupStatus,
} from '@proanima/arkvory-contracts';
import type { BackupStatusResponse } from '@proanima/arkvory-contracts';
import type { BackupControlPort } from './backup-guard.js';
import { jsonFile } from './files.js';
import { localRequest, localTarget } from './local-api.js';
import type { Installation } from './model.js';
import { report } from './output.js';
import { isUnconfirmedTermination } from './process.js';
import { runtimeEnvironment } from './runtime.js';

/** The API refused the bootstrap credential: retrying cannot help, the operator must act. */
export class BackupCredentialRejected extends Error {
  constructor() {
    super(
      'The API rejected config/bootstrap-token.txt; the backup agent state needs the owner or bootstrap key (backup.read)',
    );
    this.name = 'BackupCredentialRejected';
  }
}

export interface BackupWait {
  readonly attempts: number;
  readonly intervalMs: number;
}
/** About 90 seconds: two supervisor restarts (10 s each) of an agent that starts too early. */
export const agentWait: BackupWait = { attempts: 45, intervalMs: 2000 };

/** One call of /api/v1/backup with the file-based bootstrap key; 2xx bodies are returned parsed. */
async function backupCall(
  root: string,
  state: Installation,
  path: string,
  options: { method?: string; headers?: Readonly<Record<string, string>> } = {},
): Promise<unknown> {
  const env = runtimeEnvironment(await jsonFile(join(root, 'config/runtime.json')));
  const token = (await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8')).trim();
  const response = await localRequest(
    localTarget(env, state.mode === 'compose'),
    `/api/v1/backup${path}`,
    {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      timeoutMs: 5000,
    },
  );
  if (response.status === 401 || response.status === 403) throw new BackupCredentialRejected();
  if (response.status < 200 || response.status > 299)
    throw new Error(`Backup API is unavailable (HTTP ${String(response.status)})`);
  return JSON.parse(response.body);
}

/**
 * GET /api/v1/backup/status over the transport the installation configured. The agent
 * publishes its state only through its heartbeat in the database; the API is the single reader
 * installers use.
 */
export async function backupStatus(
  root: string,
  state: Installation,
): Promise<BackupStatusResponse> {
  return readBackupStatus(await backupCall(root, state, '/status'));
}

/** The backup API of the running release for the schema-update guard (ADR 0059). */
export function localBackupControl(root: string, state: Installation): BackupControlPort {
  return {
    status: () => backupStatus(root, state),
    run: async (key) =>
      readBackupReceipt(
        await backupCall(root, state, '/runs', {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
        }),
      ),
    jobs: async () => readBackupJobPage(await backupCall(root, state, '/jobs?limit=100')).items,
    points: async () =>
      readBackupPointPage(await backupCall(root, state, '/points?limit=100')).items,
  };
}

/** Polls until `accept` holds; null after the bounded wait. A rejected credential is final. */
export async function waitForBackup(
  probe: () => Promise<BackupStatusResponse>,
  accept: (status: BackupStatusResponse) => boolean,
  wait: BackupWait = agentWait,
): Promise<BackupStatusResponse | null> {
  for (let attempt = 0; attempt < wait.attempts; attempt++) {
    if (attempt) await delay(wait.intervalMs);
    try {
      const status = await probe();
      if (accept(status)) return status;
    } catch (error) {
      if (error instanceof BackupCredentialRejected || isUnconfirmedTermination(error)) throw error;
    }
  }
  return null;
}

/**
 * After a start: the agent's absence is visible, but it never fails an installation or update
 * and never triggers a rollback of the API.
 */
export async function reportBackupAgent(
  probe: () => Promise<BackupStatusResponse>,
  wait: BackupWait = agentWait,
): Promise<void> {
  try {
    const status = await waitForBackup(probe, (current) => current.agent.online, wait);
    if (!status)
      report(
        'warning',
        'The backup agent did not come online; backups do not run. Inspect the arkvory-backup service log',
      );
    else if (!status.vault.configured)
      report(
        'info',
        'Backup agent online without a vault: arkvory configure --root <root> --backup-vault <dir> --init-vault',
      );
    else report('info', 'Backup agent online');
  } catch (error) {
    if (isUnconfirmedTermination(error)) throw error;
    report(
      'warning',
      `Cannot confirm the backup agent: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

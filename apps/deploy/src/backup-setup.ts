import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupStatusResponse } from '@proanima/arkvory-contracts';
import { waitForBackup } from './backup-probe.js';
import type { BackupWait } from './backup-probe.js';
import { replaceText } from './files.js';
import type { Installation, Release } from './model.js';
import { isUnconfirmedTermination } from './process.js';
import { runtimeEnvironment } from './runtime.js';
import { containerVault } from './vault-access.js';
import { inspectVault } from './vault-location.js';
import type { VaultContents, VaultLocation } from './vault-location.js';

export interface BackupChange {
  readonly vault?: string;
  /** Create vault.json in an empty directory; an existing vault is never initialized again. */
  readonly initialize?: boolean;
  readonly disable?: boolean;
}
/** The service operations configure needs; Services implements them, tests substitute them. */
export interface BackupServiceControl {
  /** Registers the backup service when an older release installed this root without it. */
  adopt(release: Release): Promise<void>;
  /** Makes exactly this vault (or none) usable by the backup service; returns the undo. */
  openVault(vault: string | null): Promise<() => Promise<void>>;
  initializeVault(vault: string): Promise<void>;
  /** Contents as the vault's owner sees them; in Compose that may be only the container user. */
  readVault(vault: string): Promise<VaultContents>;
  /** Restarts only the backup service; API and worker keep serving. */
  restartBackup(): Promise<void>;
  backupStatus(): Promise<BackupStatusResponse>;
}
export interface BackupOutcome {
  readonly vaultId: string | null;
  readonly initialized: boolean;
}
/** Restart, standby until the old lease expires (60 s), then the first heartbeat. */
export const configureWait: BackupWait = { attempts: 75, intervalMs: 2000 };

function request(change: BackupChange): 'enable' | 'disable' {
  if (change.disable) {
    if (change.vault !== undefined || change.initialize)
      throw new Error('Use either --backup-vault <dir> [--init-vault] or --backup-vault-off');
    return 'disable';
  }
  if (change.vault === undefined)
    throw new Error('Specify --backup-vault <absolute directory> or --backup-vault-off');
  return 'enable';
}

async function checkedVault(
  root: string,
  state: Installation,
  env: Record<string, string>,
  change: BackupChange,
  platform: NodeJS.Platform,
  control: BackupServiceControl,
): Promise<VaultLocation> {
  const context = {
    root,
    dataDirectory: state.mode === 'compose' ? undefined : env['ARKVORY_DATA_DIR'],
    mode: state.mode,
    platform,
  };
  const location = await inspectVault(change.vault ?? '', context, (directory) =>
    control.readVault(directory),
  );
  if (location.vaultId === null && !change.initialize)
    throw new Error(
      'The directory has no vault.json: mount the vault volume, or pass --init-vault to create a vault in this empty directory',
    );
  if (location.vaultId === null && !location.empty)
    throw new Error('--init-vault needs an empty directory; this one has files but no vault.json');
  return location;
}

/** The agent's own heartbeat proves the new configuration, never a stale one of its predecessor. */
function accepted(vaultId: string | null) {
  return (status: BackupStatusResponse) =>
    status.agent.online &&
    (vaultId === null
      ? !status.vault.configured
      : status.vault.configured && status.vault.available && status.vault.id === vaultId);
}

interface Progress {
  undo: (() => Promise<void>) | null;
  restarted: boolean;
}

/** Every step runs even after a failed one; the agent restarts only if it was restarted. */
/**
 * Restores runtime.json and the previous exposure; a restarted agent must report the previous
 * state (a vault or none) before this returns, so a status read right after the command shows
 * what is configured, not the heartbeat of the refused vault.
 */
async function rollback(
  path: string,
  previous: string,
  progress: Progress,
  control: BackupServiceControl,
  wait: BackupWait | undefined,
): Promise<string> {
  const problems: string[] = [];
  const hadVault = runtimeEnvironment(JSON.parse(previous))['ARKVORY_BACKUP_VAULT'] !== undefined;
  const steps = [() => replaceText(path, previous)];
  if (progress.undo) steps.push(progress.undo);
  if (progress.restarted)
    steps.push(
      () => control.restartBackup(),
      async () => {
        const reported = await waitForBackup(
          () => control.backupStatus(),
          (status) => status.agent.online && status.vault.configured === hadVault,
          wait,
        );
        if (!reported)
          throw new Error('the backup agent did not report the previous configuration');
      },
    );
  for (const step of steps)
    await step().catch((error: unknown) => {
      problems.push(error instanceof Error ? error.message : 'rollback step failed');
    });
  return problems.length ? `; rollback incomplete: ${problems.join('; ')}` : '';
}

/**
 * `arkvory configure --backup-vault`: validate before anything changes, open the vault for the
 * service (systemd drop-in, Windows ACL or Compose bind mount), initialize it only when
 * vault.json is missing, write ARKVORY_BACKUP_VAULT, restart only the backup service and require
 * its heartbeat to report this vault (or none). Any failure restores runtime.json and the
 * previous vault exposure and restarts the agent with them. A vault.json created here stays:
 * it is an empty vault that a retry reuses.
 */
export async function configureBackup(
  root: string,
  state: Installation,
  change: BackupChange,
  control: BackupServiceControl,
  options: { readonly wait?: BackupWait; readonly platform?: NodeJS.Platform } = {},
): Promise<BackupOutcome> {
  const kind = request(change);
  const path = join(root, 'config/runtime.json');
  const previous = await readFile(path, 'utf8');
  const env = runtimeEnvironment(JSON.parse(previous));
  const location =
    kind === 'enable'
      ? await checkedVault(root, state, env, change, options.platform ?? process.platform, control)
      : null;
  const next = { ...env };
  if (location)
    next['ARKVORY_BACKUP_VAULT'] = state.mode === 'compose' ? containerVault : location.path;
  else delete next['ARKVORY_BACKUP_VAULT'];
  await control.adopt(state.current);
  const progress: Progress = { undo: null, restarted: false };
  let vaultId = location?.vaultId ?? null;
  try {
    progress.undo = await control.openVault(location?.path ?? null);
    if (location && vaultId === null) {
      await control.initializeVault(location.path);
      // Files written by the initializing account belong to the service account afterwards.
      await control.openVault(location.path);
      vaultId = (await control.readVault(location.path)).vaultId;
      if (vaultId === null) throw new Error('vault init did not create vault.json');
    }
    await replaceText(path, JSON.stringify(next, null, 2) + '\n');
    progress.restarted = true;
    await control.restartBackup();
    if (!(await waitForBackup(() => control.backupStatus(), accepted(vaultId), options.wait)))
      throw new Error(
        location
          ? 'The backup agent did not report this vault as configured and available'
          : 'The backup agent did not come online without a vault',
      );
    return { vaultId, initialized: location !== null && location.vaultId === null };
  } catch (error) {
    // A timed-out command may still change the installation; never race it with a rollback.
    if (isUnconfirmedTermination(error)) throw error;
    const reason = error instanceof Error ? error.message : 'restart failed';
    const incomplete = await rollback(path, previous, progress, control, options.wait);
    throw new Error(
      `The backup vault was not ${location ? 'configured' : 'turned off'}; the previous configuration is restored (${reason})${incomplete}`,
      { cause: error },
    );
  }
}

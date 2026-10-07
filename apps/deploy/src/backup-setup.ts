import { chown, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { BackupStatusResponse } from '@proanima/arkvory-contracts';
import { waitForBackup } from './backup-probe.js';
import type { BackupWait } from './backup-probe.js';
import { atomicText, replaceText } from './files.js';
import type { Installation, Release } from './model.js';
import { isUnconfirmedTermination } from './process.js';
import { runtimeEnvironment } from './runtime.js';
import { containerVault, containerVaultKey } from './vault-access.js';
import { inspectVault } from './vault-location.js';
import type { VaultContents, VaultLocation } from './vault-location.js';

export interface BackupChange {
  readonly vault?: string;
  /** Create vault.json in an empty directory; an existing vault is never initialized again. */
  readonly initialize?: boolean;
  /**
   * With initialize: create a vault without encryption (ADR 0070). A vault is encrypted by default,
   * but its keys are made by `arkvory-backup vault init`, so configure never makes one silently plain.
   */
  readonly plain?: boolean;
  /** File with the agent key (AK1-…) for an existing encrypted vault. */
  readonly keyFile?: string;
  readonly disable?: boolean;
}
/** The service operations configure needs; Services implements them, tests substitute them. */
export interface BackupServiceControl {
  /** Registers the backup service when an older release installed this root without it. */
  adopt(release: Release): Promise<void>;
  /**
   * Makes exactly this vault (or none) usable by the backup service; returns the undo. `keyFile`:
   * the service also reads the key file of an encrypted vault (a Compose bind mount).
   */
  openVault(
    vault: string | null,
    options?: { readonly keyFile?: boolean },
  ): Promise<() => Promise<void>>;
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
  readonly encrypted: boolean;
}
/** Restart, standby until the old lease expires (60 s), then the first heartbeat. */
export const configureWait: BackupWait = { attempts: 75, intervalMs: 2000 };

function request(change: BackupChange): 'enable' | 'disable' {
  if (change.disable) {
    if (
      change.vault !== undefined ||
      change.initialize ||
      change.plain ||
      change.keyFile !== undefined
    )
      throw new Error('Use either --backup-vault <dir> [--init-vault] or --backup-vault-off');
    return 'disable';
  }
  if (change.vault === undefined)
    throw new Error('Specify --backup-vault <absolute directory> or --backup-vault-off');
  if (change.plain && !change.initialize)
    throw new Error('--vault-no-encryption chooses how --init-vault makes a new vault');
  if (change.plain && change.keyFile !== undefined)
    throw new Error(
      '--vault-key-file is for an encrypted vault; --vault-no-encryption makes a plain one',
    );
  return 'enable';
}

/** Where the service reads its key: on the host, or inside the Compose container. */
const keyDirectory = 'config/backup';
const keyName = 'vault.key';
/** The user of the Compose containers, who owns the vault and reads the agent key file. */
const CONTAINER_USER = 1000;

/**
 * The agent key from the file the operator names (ADR 0070). Only an agent key
 * (AK1) is accepted: the recovery key is the one that must never be on this server. The key is
 * proven by the agent opening the vault, so a wrong key is rolled back like any other failure.
 */
async function serviceKey(file: string | undefined): Promise<string> {
  if (file === undefined || !isAbsolute(file))
    throw new Error('--vault-key-file must be an absolute path');
  const info = await stat(file);
  if (!info.isFile() || info.size > 64 * 1024)
    throw new Error('--vault-key-file is not a key file');
  const text = (await readFile(file, 'utf8')).toUpperCase();
  if (/\bRK1(?:-[A-Z2-7]{4}){14}\b/.test(text))
    throw new Error(
      'This is a recovery key: it stays off this server. Give the agent key file (AK1-…)',
    );
  const key = /\bAK1(?:-[A-Z2-7]{4}){14}\b/.exec(text)?.[0];
  if (key === undefined) throw new Error('--vault-key-file holds no agent key (AK1-…)');
  return key;
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
  if (location.vaultId === null && !change.plain)
    throw new Error(
      `--init-vault makes a vault without encryption only with --vault-no-encryption. For an encrypted vault (the default) run "arkvory-backup vault init ${location.path} --kit-file <file> --agent-key-file <file>" first, keep the kit off this server, then run configure with --backup-vault ${location.path} --vault-key-file <that key file>`,
    );
  if (location.vaultId !== null && change.plain)
    throw new Error(
      '--vault-no-encryption applies to a new vault; this directory already holds one',
    );
  if (location.vaultId !== null && location.encrypted && change.keyFile === undefined)
    throw new Error(
      'The vault is encrypted: pass --vault-key-file with the agent key file (AK1-…), made by "arkvory-backup vault init" or "vault key rotate-agent"',
    );
  if (location.vaultId !== null && !location.encrypted && change.keyFile !== undefined)
    throw new Error('The vault is not encrypted: do not pass --vault-key-file');
  if (location.vaultId === null && change.keyFile !== undefined)
    throw new Error('--vault-key-file belongs to an existing encrypted vault');
  return location;
}

/**
 * Installs the agent key like runtime.json is installed: root:arkvory 0640 for systemd,
 * readable by the container user for Compose, inherited ACLs on Windows.
 */
async function installKey(root: string, state: Installation, key: string): Promise<void> {
  const owner = await stat(join(root, 'config/runtime.json'));
  const directory = join(root, keyDirectory);
  await mkdir(directory, { recursive: true, mode: state.mode === 'compose' ? 0o755 : 0o750 });
  if (process.platform !== 'win32') await chown(directory, owner.uid, owner.gid);
  const path = join(directory, keyName);
  // Compose: only the container user (uid 1000) reads the key; systemd: root:arkvory 0640.
  const compose = state.mode === 'compose';
  await atomicText(path, key + '\n', compose ? 0o600 : 0o640);
  if (process.platform !== 'win32')
    await chown(path, compose ? CONTAINER_USER : owner.uid, compose ? CONTAINER_USER : owner.gid);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Puts the key file back as it was; a key file that did not exist is removed. */
async function restoreKey(path: string, previous: string | null): Promise<void> {
  if (previous === null) await unlink(path).catch(() => undefined);
  else {
    // The new key replaced the file in place, so its mode and owner are the installed ones.
    try {
      await replaceText(path, previous);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await atomicText(path, previous, 0o600);
    }
  }
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
  /** Set once the key file was written: its text before, null if there was none. */
  key?: { readonly path: string; readonly previous: string | null };
}

/**
 * The vault the agent reported before the change: its ID, null for none, undefined when the
 * agent was not online to say. A rollback waits for exactly that report.
 */
async function reportedVault(control: BackupServiceControl): Promise<string | null | undefined> {
  const status = await control.backupStatus().catch(() => null);
  if (!status?.agent.online) return undefined;
  return status.vault.configured ? status.vault.id : null;
}

/** The previous vault again, by its ID when known: the refused one may have been configured too. */
function restored(previousVault: string | null | undefined, hadVault: boolean) {
  return (status: BackupStatusResponse) =>
    status.agent.online &&
    (previousVault === undefined
      ? status.vault.configured === hadVault
      : previousVault === null
        ? !status.vault.configured
        : status.vault.configured && status.vault.id === previousVault);
}

/**
 * Restores runtime.json and the previous exposure; every step runs even after a failed one. A
 * restarted agent must report the previous state (that vault or none) before this returns, so a
 * status read right after the command shows what is configured, not the refused vault's heartbeat.
 */
async function rollback(
  path: string,
  previous: { readonly text: string; readonly vault: string | null | undefined },
  progress: Progress,
  control: BackupServiceControl,
  wait: BackupWait | undefined,
): Promise<string> {
  const problems: string[] = [];
  const hadVault =
    runtimeEnvironment(JSON.parse(previous.text))['ARKVORY_BACKUP_VAULT'] !== undefined;
  const steps = [() => replaceText(path, previous.text)];
  const key = progress.key;
  if (key) steps.push(() => restoreKey(key.path, key.previous));
  if (progress.undo) steps.push(progress.undo);
  if (progress.restarted)
    steps.push(
      () => control.restartBackup(),
      async () => {
        const reported = await waitForBackup(
          () => control.backupStatus(),
          restored(previous.vault, hadVault),
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
  // Read and checked before anything changes; the agent opening the vault proves it later.
  const key = location?.encrypted ? await serviceKey(change.keyFile) : null;
  const keyPath = join(root, keyDirectory, keyName);
  const next = { ...env };
  if (location)
    next['ARKVORY_BACKUP_VAULT'] = state.mode === 'compose' ? containerVault : location.path;
  else delete next['ARKVORY_BACKUP_VAULT'];
  if (key !== null)
    next['ARKVORY_BACKUP_VAULT_KEY_FILE'] = state.mode === 'compose' ? containerVaultKey : keyPath;
  else delete next['ARKVORY_BACKUP_VAULT_KEY_FILE'];
  await control.adopt(state.current);
  const previousVault = await reportedVault(control);
  const progress: Progress = { undo: null, restarted: false };
  let vaultId = location?.vaultId ?? null;
  try {
    progress.undo = await control.openVault(location?.path ?? null, { keyFile: key !== null });
    if (location && vaultId === null) {
      await control.initializeVault(location.path);
      // Files written by the initializing account belong to the service account afterwards.
      await control.openVault(location.path, { keyFile: key !== null });
      vaultId = (await control.readVault(location.path)).vaultId;
      if (vaultId === null) throw new Error('vault init did not create vault.json');
    }
    if (key !== null) {
      progress.key = { path: keyPath, previous: await readOptional(keyPath) };
      await installKey(root, state, key);
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
    // A vault turned off or replaced by a plain one no longer needs the agent key.
    if (key === null) await unlink(keyPath).catch(() => undefined);
    return {
      vaultId,
      initialized: location !== null && location.vaultId === null,
      encrypted: key !== null,
    };
  } catch (error) {
    // A timed-out command may still change the installation; never race it with a rollback.
    if (isUnconfirmedTermination(error)) throw error;
    const reason = error instanceof Error ? error.message : 'restart failed';
    const before = { text: previous, vault: previousVault };
    const incomplete = await rollback(path, before, progress, control, options.wait);
    throw new Error(
      `The backup vault was not ${location ? 'configured' : 'turned off'}; the previous configuration is restored (${reason})${incomplete}`,
      { cause: error },
    );
  }
}

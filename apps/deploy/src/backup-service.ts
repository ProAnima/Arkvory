import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists } from './files.js';
import { command, isUnconfirmedTermination } from './process.js';
import type { Installation, Release } from './model.js';
import { report } from './output.js';

/*
 * Supervision of the backup agent role (ADR 0057). Unlike API and worker the agent is optional
 * for readiness: a failing agent is reported, never a failed installation, update or rollback.
 * Native installations created by a release before the role have no backup service until a
 * release with it provisions the services again (Services.adopt).
 */

/** Unit written by register-linux.sh; configure adds the vault as a drop-in next to it. */
export const backupUnitFile = '/etc/systemd/system/arkvory-backup.service';
export const windowsBackupService = 'Arkvorybackup';

export type ComposeCall = (release: Release, args: string[]) => Promise<void>;
export interface BackupSupervision {
  readonly root: string;
  readonly state: Installation;
  readonly compose: ComposeCall;
}

/**
 * Whether a release ships the agent role: native releases contain the agent entry (B2 and
 * later); a Compose release must declare the service, otherwise `compose stop backup` fails.
 */
export async function shipsBackupRole(
  root: string,
  state: Installation,
  release: Release,
): Promise<boolean> {
  const directory = join(root, 'releases', release.version);
  if (state.mode !== 'compose') return exists(join(directory, 'apps/backup/dist/agent.js'));
  return /^ {2}backup:\s*$/m.test(await readFile(join(directory, 'deploy/compose.yml'), 'utf8'));
}

/** Whether the native backup service of this installation exists. */
export function backupRegistered(root: string, state: Installation): Promise<boolean> {
  if (state.mode === 'systemd') return exists(backupUnitFile);
  if (state.mode === 'windows') return exists(join(root, 'service/arkvory-backup.exe'));
  throw new Error('Compose services come with the release');
}

/** Whether stop() covers the backup role of the running release. */
export function backupRunning(context: BackupSupervision): Promise<boolean> {
  return context.state.mode === 'compose'
    ? shipsBackupRole(context.root, context.state, context.state.current)
    : backupRegistered(context.root, context.state);
}

/** WinSW stopwait is not documented for a stopped service; the guard keeps it idempotent. */
export function stopWindowsBackup(root: string): Promise<void> {
  return command(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `if ((Get-Service '${windowsBackupService}').Status -ne 'Stopped') { & $env:ARKVORY_SERVICE_WRAPPER stopwait; exit $LASTEXITCODE }`,
    ],
    undefined,
    { ARKVORY_SERVICE_WRAPPER: join(root, 'service/arkvory-backup.exe') },
  );
}

async function startOnce(context: BackupSupervision, release: Release): Promise<void> {
  if (context.state.mode === 'compose') await context.compose(release, ['up', '-d', 'backup']);
  else if (context.state.mode === 'systemd')
    await command('systemctl', ['start', 'arkvory-backup']);
  else await command(join(context.root, 'service/arkvory-backup.exe'), ['start']);
}

/**
 * Starts the agent after API and worker. `strict` (configure) propagates a failure; otherwise it
 * is a warning, except an unconfirmed timeout, which must keep the operation lock.
 */
export async function startBackup(
  context: BackupSupervision,
  release: Release,
  strict = false,
): Promise<void> {
  const { root, state } = context;
  if (!(await shipsBackupRole(root, state, release))) {
    if (strict) throw new Error('This release has no backup agent role');
    return;
  }
  if (state.mode !== 'compose' && !(await backupRegistered(root, state))) {
    if (strict) throw new Error('The backup agent service is not registered');
    report('warning', 'The backup agent service is not registered; run updates-connect');
    return;
  }
  try {
    await startOnce(context, release);
  } catch (error) {
    if (strict || isUnconfirmedTermination(error)) throw error;
    report(
      'warning',
      `The backup agent service did not start (${error instanceof Error ? error.message : 'unknown error'}); API and worker keep running`,
    );
  }
}

import { copyFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, atomicText, jsonFile } from './files.js';
import { parseInstallation, parseRelease, record, newer, updateDecision } from './model.js';
import type { Installation } from './model.js';
import { source, stage } from './staging.js';
import type { Source } from './staging.js';
import { Services } from './services.js';
import { initialize } from './initialize.js';
import { applyUpdate } from './update.js';
import type { UpdatePort } from './update.js';
import { applyMigration, recoveryDirection } from './migration-update.js';
import { guardWait, verifiedBackup } from './backup-guard.js';
import { localBackupControl } from './backup-probe.js';
import { protectInstallation } from './preflight.js';
import { prepareUpdateControl } from './update-setup.js';
import { report } from './output.js';

export async function save(root: string, state: Installation): Promise<void> {
  // Compose image follows the same journalled switch; data volumes never depend on a release directory.
  if (state.mode === 'compose')
    await atomicText(
      join(root, 'config/compose.env'),
      `ARKVORY_IMAGE=proanima-arkvory:${state.current.version}\n`,
      0o600,
    );
  await atomicJson(join(root, 'installation.json'), state);
}
export async function install(root: string, options: Map<string, string>): Promise<void> {
  const mode = options.get('mode') ?? (process.platform === 'win32' ? 'windows' : 'systemd');
  await protectInstallation(root, mode);
  try {
    await access(join(root, 'installation.json'));
    throw new Error('Already installed; use update');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const selected = await source(root, options.get('version') ?? null, options.get('artifact'));
  const state = parseInstallation({
    format: 1,
    mode,
    engine: options.get('engine') ?? 'docker',
    automatic: options.has('automatic'),
    pin: options.has('pin') ? selected.release.version : null,
    current: selected.release,
  });
  if (state.mode === 'systemd' && (process.platform !== 'linux' || process.getuid?.() !== 0))
    throw new Error('Native systemd installation requires root on Linux');
  if (state.mode === 'windows' && process.platform !== 'win32')
    throw new Error('Windows service installation requires Windows');
  await stage(root, selected);
  await initialize(root, state, options.get('config'), options.get('database-bin'));
  await copyFile(
    join(root, 'releases', state.current.version, 'deploy/launcher.mjs'),
    join(root, 'launcher.mjs'),
  );
  await copyFile(
    join(root, 'releases', state.current.version, 'deploy/manage.mjs'),
    join(root, 'manage.mjs'),
  );
  await chmod(join(root, 'launcher.mjs'), 0o644);
  await save(root, state);
  await prepareUpdateControl(root);
  const services = new Services(root, state);
  await services.prepare(state.current);
  await services.migrate(state.current);
  await services.provision(state.current);
  await services.start(state.current);
  await services.healthy();
  await services.confirmBackup(state.current);
  await services.schedule(state.current);
  report(
    'info',
    'Arkvory installed. Recovery key: config/bootstrap-token.txt. Keep it on this host for setup tools; use accounts and service keys for daily work.',
  );
}
export async function finishInstall(root: string): Promise<void> {
  await checkJournal(root);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  await prepareUpdateControl(root);
  const services = new Services(root, state);
  await services.prepare(state.current);
  await services.migrate(state.current);
  await services.provision(state.current);
  await services.start(state.current);
  await services.healthy();
  await services.confirmBackup(state.current);
  await services.schedule(state.current);
}
export async function checkJournal(root: string): Promise<void> {
  let journal: Record<string, unknown>;
  try {
    journal = record(await jsonFile(join(root, 'journal.json')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!['committed', 'rolled-back', 'recovered'].includes(String(journal['phase'])))
    throw new Error('Interrupted deployment; use recover after inspecting journal.json');
}
function updatePort(root: string, selected: Source, services: Services): UpdatePort {
  return {
    stage: async () => {
      await stage(root, selected);
      await services.prepare(selected.release);
    },
    stop: () => services.stop(),
    start: async (release) => {
      // An installation from a release without the backup role gets its service while stopped.
      await services.adopt(release);
      await services.start(release);
    },
    healthy: () => services.healthy(),
    save: (next) => save(root, next),
    journal: (value) => atomicJson(join(root, 'journal.json'), value),
  };
}
/**
 * `beat` keeps the console updater heartbeat fresh while a schema-changing update waits for
 * its backup; the operation lock is held throughout.
 */
export async function update(
  root: string,
  options: Map<string, string>,
  expectedDigest?: string,
  beat?: () => Promise<void>,
): Promise<void> {
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const scheduled = options.has('scheduled');
  if (scheduled && (!state.automatic || state.pin !== null)) {
    report('info', 'Automatic updates disabled or version pinned');
    return;
  }
  await checkJournal(root);
  const selected = await source(root, options.get('version') ?? state.pin, options.get('artifact'));
  if (expectedDigest !== undefined && selected.release.archiveSha256 !== expectedDigest)
    throw new Error('Selected release bytes changed; check releases again');
  const services = new Services(root, state);
  const port = updatePort(root, selected, services);
  if (updateDecision(state, selected.release, scheduled) === 'migrate') {
    await applyMigration(state, selected.release, {
      ...port,
      backup: async () => {
        report('info', 'Database schema changes: capturing and verifying a backup first');
        const wait = beat ? { ...guardWait, beat } : guardWait;
        const point = await verifiedBackup(localBackupControl(root, state), randomUUID(), wait);
        return `backup point ${point.pointId} of vault ${point.vaultId} (${point.snapshotAt})`;
      },
      migrate: (release) => services.migrate(release),
    });
    report('info', `Updated to ${selected.release.version} with a database migration`);
    await services.confirmBackup(selected.release);
    return;
  }
  const changed = await applyUpdate(state, selected.release, scheduled, port);
  report('info', changed ? `Updated to ${selected.release.version}` : 'Already current');
  // Outside applyUpdate: the agent never decides about a rollback of the API.
  if (changed) await services.confirmBackup(selected.release);
}
/** Completes an interrupted deployment in the direction the journal allows (ADR 0059). */
export async function recover(root: string): Promise<void> {
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const journal = record(await jsonFile(join(root, 'journal.json')));
  const previous = parseRelease(journal['previous']);
  const next = parseRelease(journal['next']);
  const services = new Services(root, state);
  await services.stop();
  if (recoveryDirection(previous, next, String(journal['phase'])) === 'forward') {
    await save(root, { ...state, current: next });
    await services.migrate(next);
    await services.adopt(next);
    await services.start(next);
    await services.healthy();
    await atomicJson(join(root, 'journal.json'), { ...journal, phase: 'committed' });
    await services.confirmBackup(next);
    return;
  }
  await save(root, { ...state, current: previous });
  await services.start(previous);
  await services.healthy();
  await atomicJson(join(root, 'journal.json'), { ...journal, phase: 'recovered' });
  await services.confirmBackup(previous);
}
/** Manual path with an operator backup: the same journal and rollback as an update (ADR 0059). */
export async function upgrade(root: string, options: Map<string, string>): Promise<void> {
  const backup = options.get('backup-record');
  if (!backup)
    throw new Error(
      'Maintenance upgrade requires --backup-record pointing to an operator backup record',
    );
  await access(backup);
  await checkJournal(root);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  const selected = await source(root, options.get('version') ?? state.pin, options.get('artifact'));
  if (
    !newer(selected.release.version, state.current.version) ||
    selected.release.schema < state.current.schema
  )
    throw new Error('Maintenance upgrade must move forward');
  if (state.pin !== null && selected.release.version !== state.pin)
    throw new Error('Unpin before maintenance upgrade');
  const services = new Services(root, state);
  await applyMigration(state, selected.release, {
    ...updatePort(root, selected, services),
    backup: () => Promise.resolve(`operator backup record ${backup}`),
    migrate: (release) => services.migrate(release),
  });
  await services.confirmBackup(selected.release);
}

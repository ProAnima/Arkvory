import { access, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { canListen, databaseSettings, ownerPassword } from './managed-database.js';
import { report } from './output.js';
import { command, DeploymentCommandFailed } from './process.js';
import { syncDirectory } from './files.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function durableMarker(directory: string, name: string, value: string): Promise<void> {
  // Persist the journal before SQL, and completion before removing bootstrap material.
  await writeFile(join(directory, name), value, { flag: 'wx', mode: 0o600, flush: true });
  await syncDirectory(directory);
}

async function initializeCluster(
  directory: string,
  executable: (name: string) => string,
): Promise<string> {
  const data = join(directory, 'cluster');
  if (!(await exists(join(data, 'PG_VERSION')))) {
    await command(executable('initdb'), [
      '-D',
      data,
      '-U',
      'arkvory_owner',
      '--pwfile',
      join(directory, 'owner-password'),
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
      '--data-checksums',
    ]);
  }
  // A partial initdb is never erased automatically. An operator can inspect/recover its files.
  const major = (await readFile(join(data, 'PG_VERSION'), 'utf8')).trim();
  if (!/^(1[6-9])$/.test(major)) throw new Error('Unsupported managed PostgreSQL major');
  return major;
}

/** What pg_isready said: 0 accepting, 1 rejecting (starting or recovering), 2 no answer. */
export type Readiness = number | null;

export interface ReadinessWait {
  /** How long the server may not answer at all before the start fails. */
  readonly silenceMs?: number;
  readonly pause?: () => Promise<unknown>;
  readonly now?: () => number;
}

/**
 * Waits until PostgreSQL accepts connections. After an unclean stop, crash recovery replays WAL
 * for as long as it needs and rejects connections meanwhile: that is waited for without limit,
 * because stopping it would restart the recovery from the beginning, again and again. Only a
 * server that exited, or that does not answer at all for `silenceMs`, fails the start.
 */
export async function waitForReady(
  probe: () => Promise<Readiness>,
  exited: () => boolean,
  {
    silenceMs = 60000,
    pause = () => delay(1000),
    now = () => performance.now(),
  }: ReadinessWait = {},
): Promise<void> {
  let answered = now();
  while (!exited()) {
    const status = await probe();
    if (status === 0) return;
    if (status === 1) answered = now();
    else if (now() - answered >= silenceMs)
      throw new Error('Managed database did not become ready');
    await pause();
  }
  throw new Error('Managed database exited before it became ready');
}

/**
 * The runner's exit code once PostgreSQL exited. Stopped on request, a clean exit is a clean stop
 * (the unit ends inactive, not failed); otherwise any exit is a failure, so it is restarted.
 */
export const runnerExitCode = (code: number | null, stopping: boolean): number =>
  stopping ? (code ?? 1) : code || 1;

function startPostgres(executable: (name: string) => string, data: string, port: number) {
  return spawn(
    executable('postgres'),
    [
      '-D',
      data,
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-c',
      'unix_socket_directories=',
      '-c',
      'password_encryption=scram-sha-256',
      // API, write locks, worker, backup agent and read gateways share it (ADR 0073).
      '-c',
      'max_connections=200',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
}

function onStopSignal(stop: () => Promise<void>) {
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void stop().catch(() => {
        process.exitCode = 1;
      });
    });
}

async function bootstrapOnce(
  directory: string,
  major: string,
  psql: (args: readonly string[]) => Promise<unknown>,
) {
  if (await exists(join(directory, 'initialized'))) return;
  // CREATE DATABASE cannot share a transaction with CREATE ROLE. A journal requires inspection
  // after interruption instead of replaying ambiguous SQL or dropping an existing database.
  if (await exists(join(directory, 'bootstrap-started')))
    throw new Error('Interrupted database bootstrap requires inspection');
  await durableMarker(directory, 'bootstrap-started', '1');
  await psql(['-X', '-v', 'ON_ERROR_STOP=1', '-f', join(directory, 'bootstrap.sql')]);
  await durableMarker(directory, 'initialized', major);
  await unlink(join(directory, 'bootstrap.sql'));
}

export async function runDatabase(root: string): Promise<void> {
  const settings = await databaseSettings(root);
  if (!settings) throw new Error('Managed database not configured');
  const directory = join(root, 'database');
  const data = join(directory, 'cluster');
  const executable = (name: string) =>
    join(settings.bin, name + (process.platform === 'win32' ? '.exe' : ''));
  const environment = { PGPASSWORD: await ownerPassword(root), PGCONNECT_TIMEOUT: '5' };
  const major = await initializeCluster(directory, executable);
  // PostgreSQL itself says only "Permission denied" for a port Windows reserved at boot.
  if (process.platform === 'win32' && !(await canListen(settings.port)))
    report(
      'error',
      `Database port ${String(settings.port)} on 127.0.0.1 is in use or reserved by Windows (netsh int ipv4 show excludedportrange protocol=tcp)`,
    );
  const child = startPostgres(executable, data, settings.port);
  let exited = false;
  let stopping = false;
  child.once('error', () => {
    exited = true;
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    exited = true;
    process.exitCode = runnerExitCode(code, stopping);
  });
  const stop = async () => {
    if (stopping || exited) return;
    stopping = true;
    await command(executable('pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '90']);
  };
  // Set by a signal handler: read through a function, not narrowed to its first value.
  const stopRequested = () => stopping;
  onStopSignal(stop);
  try {
    const args = [
      '-h',
      '127.0.0.1',
      '-p',
      String(settings.port),
      '-U',
      'arkvory_owner',
      '-d',
      'postgres',
    ];
    await waitForReady(
      () =>
        command(executable('pg_isready'), args).then(
          () => 0,
          (error: unknown) => (error instanceof DeploymentCommandFailed ? error.exitCode : null),
        ),
      () => exited,
    );
    await bootstrapOnce(directory, major, (extra) =>
      command(executable('psql'), [...args, ...extra], undefined, environment),
    );
  } catch (error) {
    // Asked to stop while starting (a long recovery, say): the stop is clean, the start not failed.
    if (stopRequested()) return;
    await stop();
    throw error;
  }
}

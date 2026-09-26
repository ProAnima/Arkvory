import { access, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { databaseSettings, ownerPassword } from './managed-database.js';
import { command } from './process.js';
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

export async function runDatabase(root: string): Promise<void> {
  const settings = await databaseSettings(root);
  if (!settings) throw new Error('Managed database not configured');
  const directory = join(root, 'database');
  const data = join(directory, 'cluster');
  const executable = (name: string) =>
    join(settings.bin, name + (process.platform === 'win32' ? '.exe' : ''));
  const environment = { PGPASSWORD: await ownerPassword(root), PGCONNECT_TIMEOUT: '5' };
  const major = await initializeCluster(directory, executable);
  const child = spawn(
    executable('postgres'),
    [
      '-D',
      data,
      '-h',
      '127.0.0.1',
      '-p',
      String(settings.port),
      '-c',
      'unix_socket_directories=',
      '-c',
      'password_encryption=scram-sha-256',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  let exited = false;
  child.once('error', () => {
    exited = true;
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    exited = true;
    process.exitCode = code || 1;
  });
  let stopping = false;
  const stop = async () => {
    if (stopping || exited) return;
    stopping = true;
    await command(executable('pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '90']);
  };
  process.once('SIGTERM', () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  });
  process.once('SIGINT', () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  });
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
    let ready = false;
    const isExited = () => exited;
    for (let attempt = 0; attempt < 60 && !isExited(); attempt++) {
      try {
        await command(executable('pg_isready'), args);
        ready = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    if (!ready) throw new Error('Managed database did not become ready');
    if (!(await exists(join(directory, 'initialized')))) {
      // CREATE DATABASE cannot share a transaction with CREATE ROLE. A journal requires inspection
      // after interruption instead of replaying ambiguous SQL or dropping an existing database.
      if (await exists(join(directory, 'bootstrap-started')))
        throw new Error('Interrupted database bootstrap requires inspection');
      await durableMarker(directory, 'bootstrap-started', '1');
      await command(
        executable('psql'),
        [...args, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(directory, 'bootstrap.sql')],
        undefined,
        environment,
      );
      await durableMarker(directory, 'initialized', major);
      await unlink(join(directory, 'bootstrap.sql'));
    }
  } catch (error) {
    await stop();
    throw error;
  }
}

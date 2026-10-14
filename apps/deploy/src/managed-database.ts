import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { command } from './process.js';
import { jsonFile } from './files.js';
import { record } from './model.js';

/** The port of installations made before the port was chosen at install; still read as valid. */
export const databasePort = 54329;

/**
 * Windows hands out 49152-65535 for outgoing connections, and Hyper-V and WinNAT reserve blocks
 * of it at boot, different ones on every boot: a port there may refuse to bind one day ("could not
 * bind ... Permission denied"). New installations on Windows take a port below that range.
 */
export function databasePortCandidates(platform: NodeJS.Platform = process.platform): number[] {
  const low = Array.from({ length: 20 }, (_, index) => 45329 + index);
  return platform === 'win32' ? low : [databasePort, ...low];
}

/** Whether this process can listen on 127.0.0.1 at `port` right now. */
export function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/** The first candidate free to listen on; refusing beats a database that cannot start. */
export async function chooseDatabasePort(
  candidates: readonly number[] = databasePortCandidates(),
  probe: (port: number) => Promise<boolean> = canListen,
): Promise<number> {
  for (const port of candidates) if (await probe(port)) return port;
  throw new Error(
    `No port for the managed database is free on 127.0.0.1 (tried ${String(candidates[0])}-${String(candidates.at(-1))})`,
  );
}

export async function configureDatabase(root: string, bin: string): Promise<string> {
  if (!isAbsolute(bin) || /[\r\n\0"%$`]/.test(bin))
    throw new Error('Invalid PostgreSQL binary directory');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql', 'pg_isready'])
    await access(join(bin, name + suffix));
  const port = await chooseDatabasePort();
  const administrator = randomBytes(32).toString('hex');
  const password = randomBytes(32).toString('hex');
  const directory = join(root, 'database');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'owner-password'), administrator, { flag: 'wx', mode: 0o600 });
  // Only generated hexadecimal literals enter SQL. The app role never receives cluster administration.
  await writeFile(
    join(directory, 'bootstrap.sql'),
    `CREATE ROLE arkvory LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;\nCREATE DATABASE arkvory OWNER arkvory;\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ bin, port }), {
    flag: 'wx',
    mode: 0o600,
  });
  return `postgresql://arkvory:${password}@127.0.0.1:${String(port)}/arkvory`;
}

export async function databaseSettings(
  root: string,
): Promise<{ bin: string; port: number } | null> {
  let value: unknown;
  try {
    value = await jsonFile(join(root, 'database/settings.json'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const data = record(value);
  const port = data['port'];
  if (
    typeof data['bin'] !== 'string' ||
    !isAbsolute(data['bin']) ||
    typeof port !== 'number' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error('Invalid managed database settings');
  return { bin: data['bin'], port };
}

export async function provisionDatabase(root: string, releaseDirectory: string): Promise<void> {
  const settings = await databaseSettings(root);
  if (!settings) return;
  if (process.platform === 'win32')
    await command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(releaseDirectory, 'deploy/database-windows.ps1'),
      '-Root',
      root,
      '-Node',
      process.execPath,
    ]);
  else
    await command('bash', [
      join(releaseDirectory, 'deploy/database-linux.sh'),
      root,
      process.execPath,
    ]);
}

export async function ownerPassword(root: string): Promise<string> {
  const value = await readFile(join(root, 'database/owner-password'), 'utf8');
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid database owner credential');
  return value;
}

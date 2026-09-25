import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { command } from './process.js';
import { jsonFile } from './files.js';
import { record } from './model.js';

export const databasePort = 54329;

export async function configureDatabase(root: string, bin: string): Promise<string> {
  if (!isAbsolute(bin) || /[\r\n\0"%$`]/.test(bin))
    throw new Error('Invalid PostgreSQL binary directory');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const name of ['initdb', 'postgres', 'pg_ctl', 'psql', 'pg_isready'])
    await access(join(bin, name + suffix));
  const administrator = randomBytes(32).toString('hex');
  const password = randomBytes(32).toString('hex');
  const directory = join(root, 'database');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'owner-password'), administrator, { flag: 'wx', mode: 0o600 });
  // Only generated hexadecimal literals enter SQL. The app role never receives cluster administration.
  await writeFile(
    join(directory, 'bootstrap.sql'),
    `CREATE ROLE depot LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;\nCREATE DATABASE depot OWNER depot;\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ bin, port: databasePort }), {
    flag: 'wx',
    mode: 0o600,
  });
  return `postgresql://depot:${password}@127.0.0.1:${String(databasePort)}/depot`;
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
  if (typeof data['bin'] !== 'string' || !isAbsolute(data['bin']) || data['port'] !== databasePort)
    throw new Error('Invalid managed database settings');
  return { bin: data['bin'], port: databasePort };
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

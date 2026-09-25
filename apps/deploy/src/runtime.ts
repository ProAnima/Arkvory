import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsonFile, inside } from './files.js';
import { record, parseInstallation } from './model.js';
import { runDatabase } from './database-runner.js';

export function runtimeEnvironment(value: unknown): Record<string, string> {
  const values = record(value);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^DEPOT_[A-Z0-9_]+$/.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value))
      throw new Error('Invalid runtime configuration');
    env[key] = value;
  }
  return env;
}
export async function runRole(
  directory: string,
  configuration: string,
  role: string,
): Promise<void> {
  const entries: Record<string, string> = {
    api: 'apps/api/dist/main.js',
    worker: 'apps/worker/dist/main.js',
    migrate: 'apps/api/dist/migrate.js',
  };
  const entry = entries[role];
  if (!entry) throw new Error('Invalid service role');
  Object.assign(process.env, runtimeEnvironment(await jsonFile(configuration)));
  process.env['DEPOT_WEB_DIR'] = join(directory, 'apps/web/public');
  process.chdir(directory);
  // A lost worker lease can finish normally. Treat unexpected service exit as failure for Windows SCM.
  if (role !== 'migrate')
    process.once('beforeExit', () => {
      process.exitCode = 1;
    });
  await import(pathToFileURL(join(directory, entry)).href);
}
export async function launch(root: string, role: string): Promise<void> {
  if (role === 'database') return runDatabase(root);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  await runRole(
    inside(root, 'releases', state.current.version),
    join(root, 'config/runtime.json'),
    role,
  );
}

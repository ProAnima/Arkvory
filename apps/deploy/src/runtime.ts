import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jsonFile, inside } from './files.js';
import { record, parseInstallation } from './model.js';
import { runDatabase } from './database-runner.js';

export function runtimeEnvironment(value: unknown): Record<string, string> {
  const values = record(value);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^ARKVORY_[A-Z0-9_]+$/.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value))
      throw new Error('Invalid runtime configuration');
    env[key] = value;
  }
  return env;
}

export interface RoleCommand {
  /** Entry point inside the release directory. */
  readonly entry: string;
  /** Arguments the entry receives, as if started as `node <entry> <argv...>`. */
  readonly argv: readonly string[];
  /** Supervised service: an exit the supervisor did not ask for is a failure. */
  readonly service: boolean;
}

/** Roles the installers register as supervised services (ADR 0031, ADR 0057). */
export const serviceRoles = ['api', 'worker', 'backup'] as const;

/**
 * What a launcher role runs. `vault-init` is the single operator command routed through the
 * launcher: `arkvory configure --init-vault` runs the backup CLI of the same release with the
 * installation's runtime environment, so the CLI repeats its own storage-separation check.
 */
export function roleCommand(role: string, args: readonly string[] = []): RoleCommand {
  if (role === 'vault-init') {
    const [vault] = args;
    if (args.length !== 1 || !vault || !isAbsolute(vault))
      throw new Error('vault-init expects one absolute vault directory');
    // Plain on purpose: configure refuses --init-vault without --vault-no-encryption (ADR 0070).
    return {
      entry: 'apps/backup/dist/main.js',
      argv: ['vault', 'init', vault, '--no-encryption'],
      service: false,
    };
  }
  if (args.length) throw new Error('Service roles take no arguments');
  switch (role) {
    case 'api':
      return { entry: 'apps/api/dist/main.js', argv: [], service: true };
    case 'worker':
      return { entry: 'apps/worker/dist/main.js', argv: [], service: true };
    case 'backup':
      return { entry: 'apps/backup/dist/main.js', argv: ['agent'], service: true };
    case 'migrate':
      return { entry: 'apps/api/dist/migrate.js', argv: [], service: false };
    default:
      throw new Error('Invalid service role');
  }
}

export async function runRole(
  directory: string,
  configuration: string,
  role: string,
  args: readonly string[] = [],
): Promise<void> {
  const selected = roleCommand(role, args);
  Object.assign(process.env, runtimeEnvironment(await jsonFile(configuration)));
  process.env['ARKVORY_WEB_DIR'] = join(directory, 'apps/web/public');
  process.chdir(directory);
  const entry = join(directory, selected.entry);
  // Entries parse process.argv like their own executables (the backup CLI reads its command).
  process.argv.splice(1, process.argv.length - 1, entry, ...selected.argv);
  // A lost worker lease can finish normally. Treat unexpected service exit as failure for Windows SCM.
  if (selected.service)
    process.once('beforeExit', () => {
      process.exitCode = 1;
    });
  await import(pathToFileURL(entry).href);
}
export async function launch(root: string, role: string, args: readonly string[] = []) {
  if (role === 'database') {
    if (args.length) throw new Error('Service roles take no arguments');
    return runDatabase(root);
  }
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  await runRole(
    inside(root, 'releases', state.current.version),
    join(root, 'config/runtime.json'),
    role,
    args,
  );
}

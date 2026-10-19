import { chmod, chown, mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { inside, jsonFile } from './files.js';
import { installId } from './hub-settings.js';
import { parseInstallation } from './model.js';
import { DeploymentCommandFailed, command, commandOutput } from './process.js';

interface CommandSpec {
  readonly positional: readonly [number, number];
  readonly flags: readonly string[];
  readonly values: readonly string[];
  /** Positional arguments that name files: made absolute before the launcher changes directory. */
  readonly files: boolean;
}

/** Every `arkvory license …` command (ADR 0078, R2), its arguments and options. */
const SPECS: Readonly<Record<string, CommandSpec>> = {
  activate: { positional: [0, 0], flags: [], values: ['key-file'], files: false },
  refresh: { positional: [0, 1], flags: [], values: [], files: false },
  deactivate: { positional: [1, 1], flags: [], values: [], files: false },
  status: { positional: [0, 0], flags: ['json'], values: [], files: false },
  request: { positional: [0, 0], flags: [], values: ['key-file', 'out'], files: false },
  install: { positional: [1, 1], flags: [], values: [], files: true },
};
const ID = /^(lic|act)_[0-9A-HJKMNP-TV-Z]{26}$/;

export interface LicenseInvocation {
  readonly command: string;
  readonly root: string;
  /** The arguments of the release-side command, every path absolute. */
  readonly args: readonly string[];
}

/**
 * Parses `arkvory license <command> … --root <dir>`. File names become absolute here: the
 * release-side command runs with the release directory as its working directory. The key itself
 * is never an argument or an environment variable: only the path of its file is passed on.
 */
export function parseLicenseCommand(
  args: readonly string[],
  cwd = process.cwd(),
): LicenseInvocation {
  const name = args[0] ?? '';
  const spec = SPECS[name];
  if (!spec)
    throw new Error(`Usage: arkvory license ${Object.keys(SPECS).join('|')} … --root <directory>`);
  let root: string | undefined;
  const positional: string[] = [];
  const passed: string[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const option = arg.slice(2);
    if (seen.has(option)) throw new Error(`Repeated --${option}`);
    seen.add(option);
    if (spec.flags.includes(option)) passed.push(arg);
    else if (option === 'root' || spec.values.includes(option)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing --${option} value`);
      if (option === 'root') root = resolve(cwd, value);
      else passed.push(arg, resolve(cwd, value));
    } else throw new Error(`Unknown option --${option} for license ${name}`);
  }
  if (!root) throw new Error('Specify --root (absolute installation directory)');
  if (/[\r\n\0"%$`]/.test(root)) throw new Error('Unsupported installation path');
  const [minimum, maximum] = spec.positional;
  if (positional.length < minimum || positional.length > maximum)
    throw new Error(`Wrong number of arguments for license ${name}`);
  if (!spec.files && positional.some((value) => !ID.test(value)))
    throw new Error('Name a licence (lic_…) or activation (act_…)');
  for (const required of spec.values)
    if (!seen.has(required)) throw new Error(`license ${name} needs --${required} <file>`);
  const files = spec.files ? positional.map((value) => resolve(cwd, value)) : positional;
  return { command: name, root, args: [name, ...files, ...passed] };
}

/**
 * `config/licenses`: the activation secrets of the service account and nobody else. POSIX: owner
 * and group of `data/` (the service account), mode 0700. Windows: no inherited rules; SYSTEM and
 * Administrators full control, LocalService (the services) modify, so the worker can rotate a
 * secret. Backups never read it: they export database tables and blobs only.
 */
export async function prepareLicenceDirectory(root: string): Promise<string> {
  const directory = inside(root, 'config', 'licenses');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');
    await commandOutput(icacls, [
      directory,
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
      '*S-1-5-19:(OI)(CI)M',
    ]);
    return directory;
  }
  const service = await stat(inside(root, 'data'));
  await chown(directory, service.uid, service.gid);
  await chmod(directory, 0o700);
  return directory;
}

/**
 * Runs a licence command of the installed release with the installation's runtime environment
 * (database, `ARKVORY_LICENSE_DIR`, hub settings, install id), as `configure --init-vault` runs
 * the backup CLI. Compose installations load no signed modules (`moduleEnvironment`), so they
 * have nothing a licence could enable and the command refuses there.
 */
export async function licenseCommand(args: readonly string[]): Promise<void> {
  const invocation = parseLicenseCommand(args);
  if (!isAbsolute(invocation.root)) throw new Error('Specify an absolute --root');
  const state = parseInstallation(await jsonFile(join(invocation.root, 'installation.json')));
  if (state.mode === 'compose')
    throw new Error(
      'Licences enable signed modules, which Compose installations do not load; use a native installation',
    );
  await prepareLicenceDirectory(invocation.root);
  // The id an activation binds to; created here if the installation never had one.
  await installId(invocation.root);
  const launcher = join(
    invocation.root,
    'releases',
    state.current.version,
    'deploy',
    'launcher.mjs',
  );
  try {
    await command(process.execPath, [launcher, invocation.root, 'license', ...invocation.args]);
  } catch (error) {
    // The release-side command printed its own reason; only the exit code is left to report.
    if (error instanceof DeploymentCommandFailed) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

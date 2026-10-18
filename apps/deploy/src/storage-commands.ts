import { join, resolve } from 'node:path';
import { jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import type { Installation } from './model.js';
import { command } from './process.js';

export const storageHelp = `storage rehome --root <dir> --from <storage> --to <storage> [--repository <r>] [--limit <n>]
                     Plan moving published content to another storage (ADR 0083, N2); the worker
                     copies and checks every blob, switches it and releases the source copy.
                     Services keep running / Перенос опубликованного содержимого в другое хранилище
storage moves --root <dir>   Moves by state / Переносы по состояниям
`;

const usage = `Usage: arkvory ${storageHelp.split('\n')[0]?.trim() ?? 'storage rehome'}`;

/** What the launcher forwards to the worker's entry, checked again there. */
function forwarded(args: readonly string[]): { root: string; rest: string[] } {
  let root: string | undefined;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(usage);
    if (name === '--root') root = value;
    else if (['--from', '--to', '--repository', '--limit'].includes(name ?? '')) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value))
        throw new Error(`Invalid value of ${name ?? ''}`);
      rest.push(name ?? '', value);
    } else throw new Error(usage);
  }
  if (root === undefined) throw new Error('Specify --root (absolute installation directory)');
  const absolute = resolve(root);
  if (/[\r\n\0"%$`]/.test(absolute)) throw new Error('Unsupported installation path');
  return { root: absolute, rest };
}

/**
 * Runs the worker's planning entry of the current release with the installation's environment:
 * through the launcher on a native installation, in a one-off worker container with Compose.
 */
async function runPlanning(root: string, state: Installation, args: readonly string[]) {
  const release = state.current.version;
  if (state.mode === 'compose') {
    const files = ['-f', join(root, 'releases', release, 'deploy/compose.yml')];
    await command(
      state.engine,
      [
        'compose',
        '--project-name',
        'proanima-arkvory',
        '--project-directory',
        root,
        '--env-file',
        join(root, 'config/compose.env'),
        ...files,
        'run',
        '--rm',
        '--no-deps',
        'worker',
        'storage-rehome',
        ...args,
      ],
      undefined,
      { ARKVORY_IMAGE: `proanima-arkvory:${release}` },
    );
    return;
  }
  const launcher = join(root, 'releases', release, 'deploy', 'launcher.mjs');
  await command(process.execPath, [launcher, root, 'storage-rehome', ...args]);
}

/** `arkvory storage rehome …` and `arkvory storage moves …` (ADR 0083, N2; host first). */
export async function storageCommand(argv: readonly string[]): Promise<void> {
  const [subcommand, ...args] = argv;
  if (subcommand !== 'rehome' && subcommand !== 'moves') throw new Error(usage);
  const { root, rest } = forwarded(args);
  if (subcommand === 'moves' && rest.length > 0) throw new Error(usage);
  const state = parseInstallation(await jsonFile(join(root, 'installation.json')));
  await runPlanning(root, state, subcommand === 'moves' ? ['--status'] : rest);
}

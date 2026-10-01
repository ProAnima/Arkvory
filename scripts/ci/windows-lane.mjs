import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function npm(root, args, { env = {}, signal } = {}) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run local CI through npm (npm run ci:local) so gates can find npm');
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...env },
      signal,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error(`npm ${args.join(' ')} failed: exit ${code}`)),
    );
  });
}

async function reports(folder) {
  try {
    return new Set((await readdir(folder)).filter((name) => name.endsWith('.json')));
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

/**
 * Runs host gates in the working tree. Only reports written by this run are copied into the
 * evidence folder; older reports in test-results/gates belong to earlier runs.
 */
export async function runWindowsLane(root, lane, { results, signal, env = {} }) {
  const folder = resolve(root, 'test-results/gates');
  const before = await reports(folder);
  let failure;
  try {
    await npm(root, ['run', 'test:db:up'], { signal });
    await npm(root, ['run', 'gate', '--', ...lane.gates], { env, signal });
  } catch (error) {
    failure = error;
  }
  await mkdir(results, { recursive: true });
  for (const name of await reports(folder))
    if (!before.has(name)) await copyFile(join(folder, name), join(results, name));
  return failure;
}

export { npm };

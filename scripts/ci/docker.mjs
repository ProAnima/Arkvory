import { spawn } from 'node:child_process';

/**
 * Docker CLI without a shell: arguments are passed verbatim, so names and paths never become
 * shell syntax. Output is captured only when asked and bounded; otherwise it streams to the
 * console so long gate runs stay observable.
 */
export function docker(args, { capture = false, quiet = false, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: [
        input === undefined ? 'ignore' : 'pipe',
        capture ? 'pipe' : 'inherit',
        quiet ? 'ignore' : 'inherit',
      ],
      windowsHide: true,
      signal,
    });
    let output = '';
    if (capture)
      child.stdout.on('data', (chunk) => {
        if (output.length < 1024 * 1024) output += chunk;
      });
    if (input !== undefined) child.stdin.end(input);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`docker ${args[0]} failed: exit ${code}`));
    });
  });
}

export async function exists(kind, name) {
  try {
    await docker([kind, 'inspect', name], { capture: true, quiet: true });
    return true;
  } catch {
    return false;
  }
}

export async function removeContainer(name) {
  if (await exists('container', name)) await docker(['rm', '-f', name], { capture: true });
}

export async function removeNetwork(name) {
  if (await exists('network', name)) await docker(['network', 'rm', name], { capture: true });
}

/** Polls a readiness command inside a container; a bounded wait, never an endless loop. */
export async function waitFor(container, command, { attempts = 60, delayMs = 2000, signal } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await docker(['exec', container, ...command], { capture: true, quiet: true, signal });
    } catch (error) {
      if (signal?.aborted || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Unreachable wait state');
}

export function exec(container, command, { user = 'runner', env = {}, workdir, signal } = {}) {
  const args = ['exec', '--user', user];
  if (workdir) args.push('--workdir', workdir);
  for (const [name, value] of Object.entries(env)) args.push('--env', `${name}=${value}`);
  return docker([...args, container, ...command], { signal });
}

import { spawn } from 'node:child_process';

export async function command(
  executable: string,
  args: string[],
  cwd?: string,
  environment?: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Deployment command timed out'));
    }, 15 * 60000);
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('Cannot start deployment command'));
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Deployment command failed (${String(code ?? 'signal')})`));
    });
  });
}

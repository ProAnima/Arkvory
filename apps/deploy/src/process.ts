import { spawn } from 'node:child_process';

export async function command(
  executable: string,
  args: string[],
  cwd?: string,
  environment?: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childEnvironment = { ...process.env, ...environment };
    // Windows PowerShell 5 must not inherit PowerShell 7's incompatible module search path.
    if (executable.toLowerCase() === 'powershell.exe') delete childEnvironment['PSModulePath'];
    const child = spawn(executable, args, {
      cwd,
      env: childEnvironment,
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

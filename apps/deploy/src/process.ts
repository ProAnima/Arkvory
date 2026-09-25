import { spawn } from 'node:child_process';
import { terminateCommandTree } from './process-termination.js';

export class DeploymentCommandTimeout extends Error {
  constructor(readonly terminationConfirmed: boolean) {
    super(
      terminationConfirmed
        ? 'Deployment command timed out; command tree terminated'
        : 'Deployment command termination unconfirmed; inspect running processes before recovery',
    );
    this.name = 'DeploymentCommandTimeout';
  }
}

export function isUnconfirmedTermination(error: unknown): boolean {
  const seen = new Set<object>();
  for (let depth = 0; depth < 16; depth++) {
    if (typeof error !== 'object' || error === null || seen.has(error)) return false;
    if (error instanceof DeploymentCommandTimeout && !error.terminationConfirmed) return true;
    seen.add(error);
    // Inspect only an own data property; reporting an error must not execute a cause getter.
    error = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
  }
  return false;
}

export async function command(
  executable: string,
  args: string[],
  cwd?: string,
  environment?: Record<string, string>,
  options: { timeoutMs?: number; terminationTimeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60000;
  const terminationTimeoutMs = options.terminationTimeoutMs ?? 10000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15 * 60000 ||
    !Number.isSafeInteger(terminationTimeoutMs) ||
    terminationTimeoutMs < 1 ||
    terminationTimeoutMs > 60000
  )
    throw new Error('Invalid deployment command deadline');
  // Windows PowerShell 5 must not inherit PowerShell 7's incompatible module search path.
  const childEnvironment = Object.fromEntries(
    Object.entries({ ...process.env, ...environment }).filter(
      ([key]) =>
        executable.toLowerCase() !== 'powershell.exe' || key.toLowerCase() !== 'psmodulepath',
    ),
  );
  const child = spawn(executable, args, {
    cwd,
    env: childEnvironment,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
  });
  const state = { startupFailed: false };
  child.once('error', () => {
    state.startupFailed = true;
  });
  const closed = new Promise<{ kind: 'closed'; code: number | null }>((resolve) => {
    child.once('close', (code) => {
      resolve({ kind: 'closed', code });
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });
  const result = await Promise.race([closed, expired]);
  if (timer) clearTimeout(timer);
  if (result.kind === 'timeout') {
    const confirmed = await terminateCommandTree(child, closed, terminationTimeoutMs);
    // Keep the durable operation lock, but let the CLI report a failure instead of hanging forever.
    if (!confirmed) child.unref();
    throw new DeploymentCommandTimeout(confirmed);
  }
  if (state.startupFailed) throw new Error('Cannot start deployment command');
  if (result.code !== 0)
    throw new Error(`Deployment command failed (${String(result.code ?? 'signal')})`);
}

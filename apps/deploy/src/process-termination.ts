import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

async function beforeDeadline(work: Promise<unknown>, remaining: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(
          () => {
            resolve(false);
          },
          Math.max(1, remaining),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A timeout is not cancellation until the OS has finished terminating our command tree. */
export async function terminateCommandTree(
  child: ChildProcess,
  closed: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) return false;
  const deadline = Date.now() + timeoutMs;
  if (process.platform === 'win32') {
    const terminated = await beforeDeadline(
      new Promise<void>((resolve, reject) => {
        execFile(
          'taskkill.exe',
          ['/PID', String(pid), '/T', '/F'],
          { windowsHide: true, timeout: timeoutMs, killSignal: 'SIGKILL' },
          (error) => {
            if (error) reject(new Error('Command tree termination unconfirmed'));
            else resolve();
          },
        );
      }),
      timeoutMs,
    );
    return terminated && (await beforeDeadline(closed, deadline - Date.now()));
  }
  // The child is a new process-group leader. Never signal the installer's own group.
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) return false;
  }
  if (!(await beforeDeadline(closed, deadline - Date.now()))) return false;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH';
    }
    await delay(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return false;
}

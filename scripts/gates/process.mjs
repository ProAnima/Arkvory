import { spawn, execFile } from 'node:child_process';

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGKILL');
    }
  }
}
export function runProcess(script, args, { cwd, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Gate cancelled'));
      return;
    }
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let timedOut = false,
      cancelled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    const abort = () => {
      cancelled = true;
      terminate(child);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    child.once('error', (error) => {
      clean();
      reject(error);
    });
    child.once('exit', (code, exitSignal) => {
      clean();
      if (timedOut) reject(new Error(`Gate command timed out after ${timeoutMs} ms`));
      else if (cancelled) reject(new Error('Gate cancelled'));
      else if (code !== 0) reject(new Error(`Gate command failed: exit ${code ?? exitSignal}`));
      else resolve();
    });
  });
}

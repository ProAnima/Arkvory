import { spawn } from 'node:child_process';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Same budget as the WinSW service logs (roll-by-size 20480 KiB, 5 files). */
export const updaterLogLimits = { maxBytes: 20 * 1024 * 1024, keep: 5 } as const;

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Size-based rotation before a run: file -> file.1 -> ... -> file.(keep-1); the oldest is
 * removed. Disk use stays within keep x maxBytes plus the output of one run. Rotation is
 * skipped when another process holds the file open (Windows refuses the rename).
 */
export async function rotateLog(path: string, maxBytes: number, keep: number): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(keep) || keep < 1)
    throw new Error('Invalid log rotation limits');
  try {
    if ((await stat(path)).size < maxBytes) return;
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  try {
    await rm(`${path}.${String(keep - 1)}`, { force: true });
    for (let index = keep - 2; index >= 1; index--)
      await rename(`${path}.${String(index)}`, `${path}.${String(index + 1)}`).catch(
        (error: unknown) => {
          if (!missing(error)) throw error;
        },
      );
    if (keep > 1) await rename(path, `${path}.1`);
    else await rm(path, { force: true });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['EBUSY', 'EPERM'].includes(String(error.code))
    )
      return;
    throw error;
  }
}

/**
 * Runs a command with stdout and stderr appended directly to a rotated log file. The child gets
 * the file descriptor itself, not a pipe: if this process is killed (scheduler time limit), the
 * child keeps a valid output and is not interrupted by a broken pipe in the middle of an update.
 * Returns undefined when the log cannot be prepared, so the caller can run without capture.
 */
export async function runWithLogFile(
  file: string,
  command: string,
  args: readonly string[],
  limits: { readonly maxBytes: number; readonly keep: number } = updaterLogLimits,
): Promise<number | undefined> {
  let handle;
  try {
    await mkdir(dirname(file), { recursive: true });
    await rotateLog(file, limits.maxBytes, limits.keep);
    handle = await open(file, 'a', 0o640);
  } catch {
    return undefined;
  }
  try {
    const child = spawn(command, [...args], {
      stdio: ['ignore', handle.fd, handle.fd],
      windowsHide: true,
      shell: false,
    });
    return await new Promise<number>((resolve) => {
      child.once('error', () => {
        resolve(1);
      });
      child.once('exit', (code) => {
        resolve(code ?? 1);
      });
    });
  } finally {
    await handle.close();
  }
}

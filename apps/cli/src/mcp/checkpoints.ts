import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClientError, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { CliError } from '../errors.js';
import { exclusive, exists } from '../local-files.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long and how many upload checkpoints `mcp --write` keeps (ADR 0081, stage M2). */
export const checkpointBounds = { ageMs: 30 * DAY_MS, count: 1000 } as const;

// Names `write-tools.ts` gives checkpoints, and the temporary files `saveJson` writes beside them.
const checkpoint = /^[0-9a-f]{64}\.json$/;
const temporary = /^[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/;

const locked = (error: unknown) => error instanceof CliError && error.code === 'state_locked';

/**
 * Bounds the checkpoint directory: a checkpoint older than `ageMs`, or beyond the newest
 * `count`, is removed, and so is a temporary file left by a crash a day ago. A checkpoint is
 * removed only under its own lock, and one with a lock file is never touched: its upload may be
 * running, or its process died and the person decides (the transfer lock is never stolen). Only
 * names this server writes are considered; anything else in the directory stays.
 *
 * Removing a receipt is safe but not free: repeating that exact call afterwards uploads again
 * under a new idempotency key instead of returning the earlier artifact.
 */
export async function pruneCheckpoints(
  directory: string,
  now: number,
  bounds: { readonly ageMs: number; readonly count: number } = checkpointBounds,
): Promise<string[]> {
  const names = await readdir(directory);
  const present = new Set(names);
  const candidates: { name: string; modified: number }[] = [];
  const removed: string[] = [];
  for (const name of names) {
    if (!checkpoint.test(name) && !temporary.test(name)) continue;
    const info = await lstat(join(directory, name)).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (temporary.test(name)) {
      if (now - info.mtimeMs > DAY_MS) {
        await rm(join(directory, name), { force: true });
        removed.push(name);
      }
    } else if (!present.has(`${name}.lock`)) candidates.push({ name, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified);
  for (const [index, { name, modified }] of candidates.entries()) {
    if (index < bounds.count && now - modified <= bounds.ageMs) continue;
    const path = join(directory, name);
    try {
      await exclusive(path, () => rm(path, { force: true }));
      removed.push(name);
    } catch (error) {
      // Another call took it meanwhile; it stays until the next start.
      if (!locked(error)) throw error;
    }
  }
  return removed;
}

/**
 * Failures after which the upload a checkpoint names can never complete: the server cancelled
 * it or let it expire, its completion failed, or its stored parts are not these bytes. Repeating
 * the call with that checkpoint would fail the same way for good, because the checkpoint's name
 * is derived from the call and the agent cannot choose another one (unlike `--state`).
 */
export function abandoned(error: unknown): boolean {
  if (error instanceof ArkvoryClientError)
    return ['upload_cancelled', 'completion_failed', 'file_changed'].includes(error.code);
  return (
    error instanceof ArkvoryHttpError &&
    error.code === 'conflict' &&
    error.reason === 'upload_expired'
  );
}

/**
 * Runs `attempt` and, when a checkpoint left by an earlier call names an abandoned upload,
 * removes it (under its lock) and starts once more under a new idempotency key. An upload this
 * call began itself is never restarted: if it is cancelled meanwhile, the failure is returned.
 */
export async function startingOver<T>(state: string, attempt: () => Promise<T>): Promise<T> {
  const earlier = await exists(state);
  try {
    return await attempt();
  } catch (error) {
    if (!earlier || !abandoned(error)) throw error;
    await exclusive(state, () => rm(state, { force: true }));
    return attempt();
  }
}

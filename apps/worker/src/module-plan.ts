import { setTimeout as delay } from 'node:timers/promises';

/** The writer's recorded plan (`PostgresModulePlan`). */
export interface RecordedPlan {
  read(): Promise<string | null>;
}

/** Pause between looks at the recorded plan while this worker's differs. */
export const planRetryMs = 5000;
/** How often a running worker compares its plan with the recorded one. */
export const planWatchMs = 30_000;

/**
 * Waits until the writer has recorded this worker's module plan (ADR 0079, section 3): a worker
 * with another plan, or before any writer of this schema started, takes no work. The mismatch is
 * reported once; stopping the process while it waits returns false. A database failure rejects,
 * like any other failure of the worker's start.
 */
export async function awaitModulePlan(
  recorded: RecordedPlan,
  fingerprint: string,
  stop: AbortSignal,
  onMismatch: () => void,
  retryMs = planRetryMs,
): Promise<boolean> {
  let reported = false;
  while (!stop.aborted) {
    if ((await recorded.read()) === fingerprint) return true;
    if (!reported) onMismatch();
    reported = true;
    await delay(retryMs, undefined, { signal: stop }).catch(() => undefined);
  }
  return false;
}

/**
 * Compares the recorded plan with this worker's every `intervalMs` while it runs and calls
 * `onChange` once when they differ: the writer was restarted with other modules, so this worker
 * must be restarted too. One look at a time; a failed look is retried at the next interval, as
 * the worker's own ownership checks report a lost database. Returns the function that stops it.
 */
export function watchModulePlan(
  recorded: RecordedPlan,
  fingerprint: string,
  onChange: () => void,
  intervalMs = planWatchMs,
): () => void {
  let looking = false;
  let changed = false;
  const timer = setInterval(() => {
    if (looking || changed) return;
    looking = true;
    recorded
      .read()
      .then((current) => {
        if (current === fingerprint || changed) return;
        changed = true;
        onChange();
      })
      .catch(() => undefined)
      .finally(() => {
        looking = false;
      });
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

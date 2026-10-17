import { setTimeout as delay } from 'node:timers/promises';

/** The writer's recorded plan (`PostgresModulePlan`). */
export interface RecordedPlan {
  read(): Promise<string | null>;
}

/** Pause between looks at the recorded plan while this worker's differs. */
export const planRetryMs = 5000;
/** How often a running worker compares its plan with the recorded one. */
export const planWatchMs = 30_000;

/** How the worker takes and gives back its lock and resources around a look at the plan. */
export interface PlannedStart<Resources> {
  /** Takes the completion worker's lock with the resources; null once the process stops. */
  acquire(): Promise<Resources | null>;
  /** The writer's recorded plan, read through the acquired resources. */
  recorded(resources: Resources): RecordedPlan;
  /** Gives the resources and so the lock back. */
  release(resources: Resources): Promise<void>;
  /** Called once, on the first mismatch. */
  onMismatch(): void;
}

/**
 * Takes the worker's lock and resources once the writer has recorded this worker's module plan
 * (ADR 0079, section 3): a worker with another plan, or before any writer of this schema
 * started, takes no work. It releases the lock while it waits, so a standby worker with the
 * writer's plan can take over meanwhile, and looks again every `retryMs`. The mismatch is
 * reported once; stopping the process while it waits returns null. A database failure releases
 * the resources and rejects, like any other failure of the worker's start.
 */
export async function acquireWithPlan<Resources>(
  start: PlannedStart<Resources>,
  fingerprint: string,
  stop: AbortSignal,
  retryMs = planRetryMs,
): Promise<Resources | null> {
  let reported = false;
  while (!stop.aborted) {
    const resources = await start.acquire();
    if (resources === null) return null;
    let current: string | null;
    try {
      current = await start.recorded(resources).read();
    } catch (error) {
      await start.release(resources);
      throw error;
    }
    if (current === fingerprint) return resources;
    await start.release(resources);
    if (!reported) start.onMismatch();
    reported = true;
    await delay(retryMs, undefined, { signal: stop }).catch(() => undefined);
  }
  return null;
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

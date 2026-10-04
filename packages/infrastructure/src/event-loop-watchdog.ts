import { Worker } from 'node:worker_threads';

/** Default seconds without a heartbeat after which a service process ends itself. */
export const DEFAULT_WATCHDOG_SECONDS = 60;

/**
 * ARKVORY_WATCHDOG_SECONDS: unset is the default, 0 turns the watchdog off (a debugger that
 * pauses the process would otherwise get it killed), else 10 to 3600 seconds.
 */
export function watchdogSeconds(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_WATCHDOG_SECONDS;
  if (!/^(0|[1-9][0-9]{0,3})$/.test(value)) throw new Error('Invalid ARKVORY_WATCHDOG_SECONDS');
  const seconds = Number(value);
  if (seconds !== 0 && (seconds < 10 || seconds > 3600))
    throw new Error('ARKVORY_WATCHDOG_SECONDS must be 0 or 10 to 3600');
  return seconds;
}

// The watcher thread, evaluated in its own isolate. Eval code is CommonJS or an ES module by
// the parent's input type, so built-ins come from process.getBuiltinModule, valid in both.
const watcherSource = `
const { workerData } = process.getBuiltinModule('node:worker_threads');
const { writeSync } = process.getBuiltinModule('node:fs');
const { beat, limit, interval, fields } = workerData;
let last = Atomics.load(beat, 0);
let misses = 0;
setInterval(() => {
  const now = Atomics.load(beat, 0);
  misses = now === last ? misses + 1 : 0;
  last = now;
  if (misses < limit) return;
  const record = {
    timestamp: new Date().toISOString(),
    level: 'error',
    ...fields,
    component: 'process',
    code: 'process.stalled',
    stalledSeconds: Math.round((misses * interval) / 1000),
  };
  try {
    writeSync(2, JSON.stringify(record) + '\\n');
  } finally {
    process.kill(process.pid, 'SIGKILL');
  }
}, interval);
`;

export interface EventLoopWatchdog {
  stop(): void;
}

/**
 * A stalled event loop (an endless loop, a blocking call, a hang in native code) answers no
 * request and runs no timer: the process neither works nor exits, so systemd, the Windows
 * service manager and Docker would leave it as it is. The main thread raises a shared counter
 * every interval; a watcher thread kills the process when the counter has not moved for
 * `seconds`, and the supervisor restarts it like after a crash (ADR 0067).
 *
 * Missed beats are counted by the watcher's own ticks, not by clock time: when the host
 * sleeps or a VM pauses, both threads stop and no stall is invented on resume. The record is
 * written synchronously to stderr before the kill; the main thread cannot log anymore.
 */
export function startEventLoopWatchdog(options: {
  readonly seconds: number;
  /** Identity of the process for the stall record (service, version, pid, hostname). */
  readonly fields: object;
  readonly onError: (error: unknown) => void;
  readonly intervalMs?: number;
}): EventLoopWatchdog {
  if (options.seconds === 0) return { stop: () => undefined };
  const interval = options.intervalMs ?? 1000;
  const beat = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const timer = setInterval(() => Atomics.add(beat, 0, 1), interval);
  timer.unref();
  const watcher = new Worker(watcherSource, {
    eval: true,
    workerData: {
      beat,
      limit: Math.ceil((options.seconds * 1000) / interval),
      interval,
      fields: options.fields,
    },
  });
  // A failed watcher only removes the safeguard; the service itself goes on.
  watcher.on('error', options.onError);
  watcher.unref();
  return {
    stop() {
      clearInterval(timer);
      void watcher.terminate();
    },
  };
}

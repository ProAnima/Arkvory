import { Worker } from 'node:worker_threads';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ComputePool,
  ComputeMessage,
  ComputeTask,
  ModuleSignal,
} from '@proanima/arkvory-extension-api';
import { computeMessage } from './module-compute-message.js';

interface Job {
  readonly entry: string;
  readonly input: ComputeMessage;
  readonly signal: ModuleSignal;
  resolve(value: ComputeMessage): void;
  reject(error: unknown): void;
  readonly abort: () => void;
}
/** One bounded thread per module. Verified entries are supplied only by loadInstallation. */
export class ModuleCompute implements ComputePool {
  private readonly queue: Job[] = [];
  private running: { worker: Worker; done: Promise<void>; cancel(): void } | undefined;
  private closed = false;
  constructor(
    private readonly directory: string,
    private readonly tasks: readonly ComputeTask[],
    private readonly timeoutMs = 60_000,
  ) {}
  run(task: string, input: ComputeMessage, signal: ModuleSignal): Promise<ComputeMessage> {
    if (this.closed) return Promise.reject(new ModuleServiceError('unavailable'));
    const entry = this.tasks.find((item) => item.name === task)?.entry;
    if (!entry) return Promise.reject(new ModuleServiceError('invalid_input'));
    if (this.queue.length >= 64) return Promise.reject(new ModuleServiceError('busy'));
    signal.throwIfAborted();
    // Validation creates an owned snapshot, including exact-sized byte views.
    const message = computeMessage(input);
    return new Promise((resolve, reject) => {
      const job: Job = {
        entry,
        input: message,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(new ModuleServiceError('unavailable'));
          }
        },
      };
      signal.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.next();
    });
  }
  private next(): void {
    if (this.running || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    job.signal.removeEventListener('abort', job.abort);
    if (job.signal.aborted) {
      job.reject(new ModuleServiceError('unavailable'));
      this.next();
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./module-compute-thread.js', import.meta.url), {
        workerData: { directory: this.directory, entry: job.entry, input: job.input },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
        execArgv: [],
      });
    } catch {
      job.reject(new ModuleServiceError('unavailable'));
      this.next();
      return;
    }
    let terminated: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      terminated = resolve;
    });
    let finished = false;
    const finish = (error?: unknown, value?: ComputeMessage) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.signal.removeEventListener('abort', abort);
      const settled = (terminationError?: unknown) => {
        this.running = undefined;
        if (terminationError || error) job.reject(terminationError ?? error);
        else job.resolve(value ?? null);
        terminated();
        this.next();
      };
      void worker.terminate().then(
        () => {
          settled();
        },
        () => {
          settled(new ModuleServiceError('unavailable'));
        },
      );
    };
    const abort = () => {
      finish(new ModuleServiceError('unavailable'));
    };
    const timer = setTimeout(() => {
      finish(new ModuleServiceError('unavailable', 'compute_timeout'));
    }, this.timeoutMs);
    this.running = { worker, done, cancel: abort };
    job.signal.addEventListener('abort', abort, { once: true });
    worker.once('error', abort);
    worker.once('messageerror', abort);
    worker.once('exit', () => {
      if (!finished) abort();
    });
    worker.once('message', (value: unknown) => {
      try {
        finish(undefined, computeMessage(value));
      } catch (error) {
        finish(error);
      }
    });
  }
  async close(): Promise<void> {
    const running = this.running;
    this.closed = true;
    running?.cancel();
    for (const job of this.queue.splice(0)) {
      job.signal.removeEventListener('abort', job.abort);
      job.reject(new ModuleServiceError('unavailable'));
    }
    await running?.done;
  }
}

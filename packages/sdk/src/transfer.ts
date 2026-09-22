export class DepotHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    readonly retryAfterMs?: number,
  ) {
    super(`Depot request failed (${String(status)}, ${code})`);
  }
}

export class DepotNetworkError extends Error {
  constructor() {
    super('Depot connection interrupted');
  }
}

export class DepotIntegrityError extends Error {
  constructor() {
    super('Downloaded content does not match the artifact');
  }
}

export interface TransferPolicy {
  /** Includes the first attempt, per request. Range/part retries replay at most 8 MiB. */
  readonly maxAttempts?: number;
  /** Shared by all requests in one create/resume/download operation. */
  readonly maxRetries?: number;
  readonly attemptTimeoutMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}
export interface TransferOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (event: { attempt: number; delayMs: number }) => void;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error('Invalid transfer policy');
  return result;
}

export function transferPolicy(policy: TransferPolicy) {
  const baseDelayMs = bounded(policy.baseDelayMs, 500, 1, 60_000);
  return {
    maxAttempts: bounded(policy.maxAttempts, 5, 1, 10),
    maxRetries: bounded(policy.maxRetries, 20, 0, 100),
    attemptTimeoutMs: bounded(policy.attemptTimeoutMs, 120_000, 1, 1_800_000),
    baseDelayMs,
    maxDelayMs: bounded(policy.maxDelayMs, 60_000, baseDelayMs, 60_000),
  };
}

export function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function delay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      const reason: unknown = signal?.reason;
      reject(
        reason instanceof Error ? reason : new DOMException('Transfer cancelled', 'AbortError'),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Only wrap explicitly idempotent operations. Includes response-body consumption. */
export class TransferAttempts {
  private retries = 0;
  constructor(
    private readonly policy: ReturnType<typeof transferPolicy>,
    private readonly options: TransferOptions,
  ) {}

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs = this.policy.attemptTimeoutMs,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      this.options.signal?.throwIfAborted();
      const timeout = new AbortController();
      const timer = setTimeout(() => {
        timeout.abort(new DepotNetworkError());
      }, timeoutMs);
      const signal = this.options.signal
        ? AbortSignal.any([this.options.signal, timeout.signal])
        : timeout.signal;
      let failure: unknown;
      try {
        return await operation(signal);
      } catch (error) {
        failure = error;
      } finally {
        clearTimeout(timer);
      }
      this.options.signal?.throwIfAborted();
      const retryable =
        failure instanceof DepotNetworkError ||
        (failure instanceof DepotHttpError && [408, 429, 502, 503, 504].includes(failure.status));
      if (
        !retryable ||
        attempt >= this.policy.maxAttempts ||
        this.retries >= this.policy.maxRetries
      )
        throw failure;
      const backoff = Math.min(
        this.policy.maxDelayMs,
        this.policy.baseDelayMs * 2 ** (attempt - 1),
      );
      const wait = Math.max(
        Math.floor(backoff / 2 + (Math.random() * backoff) / 2),
        failure instanceof DepotHttpError ? (failure.retryAfterMs ?? 0) : 0,
      );
      // Never retry earlier than Retry-After to fit our local budget.
      if (wait > this.policy.maxDelayMs) throw failure;
      this.retries++;
      this.options.onRetry?.({ attempt, delayMs: wait });
      await delay(wait, this.options.signal);
    }
  }
}

export async function readNetwork(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  try {
    return await reader.read();
  } catch {
    signal?.throwIfAborted();
    throw new DepotNetworkError();
  }
}

export async function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // A failed network stream is already closed; preserve the original failure.
  } finally {
    reader.releaseLock();
  }
}

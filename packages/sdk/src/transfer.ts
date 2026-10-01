import type { ErrorDetailResponse } from '@proanima/arkvory-contracts';

/** Optional members of the server error envelope (ADR 0051). */
export interface HttpErrorDetails {
  readonly serverMessage?: string;
  readonly reason?: string;
  readonly details?: readonly ErrorDetailResponse[];
}

/**
 * A non-2xx answer. `code`/`reason` are machine values; unknown reasons must be tolerated.
 * `serverMessage` is the fixed English operator text and is deliberately not Error.message,
 * so it never reaches a localized UI by accident.
 */
export class ArkvoryHttpError extends Error {
  readonly serverMessage: string;
  readonly reason: string | undefined;
  readonly details: readonly ErrorDetailResponse[];
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    readonly retryAfterMs?: number,
    extra: HttpErrorDetails = {},
  ) {
    super(`Arkvory request failed (${String(status)}, ${code})`);
    this.name = 'ArkvoryHttpError';
    this.serverMessage = extra.serverMessage ?? '';
    this.reason = extra.reason;
    this.details = extra.details ?? [];
  }
  /** Whole seconds of Retry-After or of the body's retryAfterSeconds, when the server sent one. */
  get retryAfterSeconds(): number | undefined {
    return this.retryAfterMs === undefined ? undefined : Math.ceil(this.retryAfterMs / 1000);
  }
}

export class ArkvoryNetworkError extends Error {
  constructor() {
    super('Arkvory connection interrupted');
    this.name = 'ArkvoryNetworkError';
  }
}

export class ArkvoryIntegrityError extends Error {
  constructor() {
    super('Downloaded content does not match the artifact');
    this.name = 'ArkvoryIntegrityError';
  }
}

/** Failures detected by the SDK itself, before or after talking to the server. */
export type ClientErrorCode =
  | 'invalid_argument'
  | 'insecure_url'
  | 'invalid_response'
  | 'response_too_large'
  | 'size_mismatch'
  | 'file_changed'
  | 'upload_cancelled'
  | 'completion_failed';

/** Machine-coded local failure; `message` keeps the previous English text for old callers. */
export class ArkvoryClientError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    /** For completion_failed: the server job error code, itself a machine value. */
    readonly serverCode?: string,
  ) {
    super(message);
    this.name = 'ArkvoryClientError';
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
    throw new ArkvoryClientError('invalid_argument', 'Invalid transfer policy');
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

export async function delay(ms: number, signal?: AbortSignal) {
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
        timeout.abort(new ArkvoryNetworkError());
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
      // 500 internal is a server defect, not a transient state: it is never retried.
      const retryable =
        failure instanceof ArkvoryNetworkError ||
        (failure instanceof ArkvoryHttpError && [408, 429, 502, 503, 504].includes(failure.status));
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
        failure instanceof ArkvoryHttpError ? (failure.retryAfterMs ?? 0) : 0,
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
    throw new ArkvoryNetworkError();
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

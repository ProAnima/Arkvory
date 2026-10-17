import type { ErrorDetailResponse, EventWindowResponse } from '@proanima/arkvory-contracts';

/** Optional members of the server error envelope (ADR 0051). */
export interface HttpErrorDetails {
  readonly serverMessage?: string;
  readonly reason?: string;
  readonly details?: readonly ErrorDetailResponse[];
  readonly queue?: DownloadQueuePlace;
  /** The event feed window of events_cursor_expired and events_epoch_changed (ADR 0080). */
  readonly events?: EventWindowResponse;
}

/** Queue classes of downloads, highest first (ADR 0076). */
export type DownloadClass = 'interactive' | 'release' | 'bulk' | 'background';

/** A queued download's place, from Arkvory-Queue-Position and Arkvory-Starts-At (ADR 0076). */
export interface DownloadQueuePlace {
  /** 1 is next. */
  readonly position?: number;
  /** The server's estimate of when the download starts. */
  readonly startsAt?: Date;
  /** Opaque proof of the download's turn; send it back (ADR 0076). */
  readonly ticket?: string;
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
  /** For 503 busy with reason download_queued: the place in the server's download queue. */
  readonly queue: DownloadQueuePlace | undefined;
  /** For gone/events_cursor_expired and conflict/events_epoch_changed: epoch, oldest, head. */
  readonly events: EventWindowResponse | undefined;
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
    this.queue = extra.queue;
    this.events = extra.events;
  }
  /** Whole seconds of Retry-After or of the body's retryAfterSeconds, when the server sent one. */
  get retryAfterSeconds(): number | undefined {
    return this.retryAfterMs === undefined ? undefined : Math.ceil(this.retryAfterMs / 1000);
  }
}

export class ArkvoryNetworkError extends Error {
  /** `cause`: the platform's failure, when there is one (its code tells refused from untrusted). */
  constructor(cause?: unknown) {
    super('Arkvory connection interrupted', cause === undefined ? undefined : { cause });
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
  | 'completion_failed'
  /** ADR 0076: the server's queue would start the download after the caller's `notAfter`. */
  | 'queue_deadline';

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
  /** Default of TransferOptions.waitLimitMs for every operation of a client. */
  readonly waitLimitMs?: number;
  /** Default of TransferOptions.onWait for every operation of a client. */
  readonly onWait?: TransferOptions['onWait'];
}
/** A wait the server asked for; `queue` is set when the download waits in its queue. */
export interface WaitEvent {
  readonly delayMs: number;
  readonly waitedMs: number;
  readonly queue?: DownloadQueuePlace;
}

export interface TransferOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (event: { attempt: number; delayMs: number }) => void;
  /**
   * How long one operation may wait in total for a server that answered `busy` (503) or
   * `rate_limited` (429) with Retry-After. Unset: as long as the server asks (ADR 0076); the
   * signal still cancels. Such waits never use the retry budget, which is for failures.
   */
  readonly waitLimitMs?: number;
  /** Called before each wait the server asked for, e.g. to show that the download is queued. */
  readonly onWait?: (event: WaitEvent) => void;
}

/** The server's own "come later": its queue or limit is full, nothing failed (ADR 0076). */
export function serverAskedToWait(failure: unknown): failure is ArkvoryHttpError {
  return (
    failure instanceof ArkvoryHttpError &&
    failure.retryAfterMs !== undefined &&
    ((failure.status === 503 && failure.code === 'busy') ||
      (failure.status === 429 && failure.code === 'rate_limited'))
  );
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
    ...(policy.waitLimitMs === undefined
      ? {}
      : { waitLimitMs: bounded(policy.waitLimitMs, 0, 0, Number.MAX_SAFE_INTEGER) }),
    ...(policy.onWait ? { onWait: policy.onWait } : {}),
  };
}

export function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** setTimeout fires at once for a longer time: it counts milliseconds in 32 signed bits. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/**
 * The longest single wait a server's Retry-After may ask: a huge value (a proxy's, or a mistake)
 * must not park a transfer for days; the client asks again after this and learns anew.
 */
const MAX_ASKED_WAIT_MS = 60 * 60 * 1000;

/** Waits `ms` (any length, e.g. until a `notBefore` days ahead) or until the signal aborts. */
export async function delay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let left = Number.isNaN(ms) ? 0 : Math.max(0, ms);
  do {
    signal?.throwIfAborted();
    const step = Math.min(left, MAX_TIMER_MS);
    await sleep(step, signal);
    left -= step;
  } while (left > 0);
}

/** A wait until a time of the wall clock reads the clock again at least this often. */
const WALL_CLOCK_STEP_MS = 60_000;

/**
 * Waits until the wall-clock time `at` (epoch milliseconds) or until the signal aborts. A timer
 * counts running time only: a laptop asleep, a paused VM or a clock set anew would shift a single
 * long timer by hours, so the remainder is read from the clock again every minute.
 */
export async function waitUntil(at: number, signal?: AbortSignal, now: () => number = Date.now) {
  signal?.throwIfAborted();
  for (let left = at - now(); left > 0; left = at - now())
    await delay(Math.min(left, WALL_CLOCK_STEP_MS), signal);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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
  private waitedMs = 0;
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
      if (serverAskedToWait(failure)) {
        await this.waitAsAsked(failure);
        // Waiting is no attempt: the request's own attempts stay for real failures.
        attempt--;
        continue;
      }
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
      const wait = retryDelay(
        this.policy,
        attempt,
        failure instanceof ArkvoryHttpError ? (failure.retryAfterMs ?? 0) : 0,
        Math.random,
      );
      if (wait > this.policy.maxDelayMs) throw failure;
      this.retries++;
      this.options.onRetry?.({ attempt, delayMs: wait });
      await delay(wait, this.options.signal);
    }
  }

  private async waitAsAsked(failure: ArkvoryHttpError): Promise<void> {
    const asked = Math.min(failure.retryAfterMs ?? 0, MAX_ASKED_WAIT_MS);
    const wait = waitDelay(this.policy.baseDelayMs, asked, Math.random);
    const limit = this.options.waitLimitMs ?? this.policy.waitLimitMs;
    if (limit !== undefined && this.waitedMs + wait > limit) throw failure;
    (this.options.onWait ?? this.policy.onWait)?.({
      delayMs: wait,
      waitedMs: this.waitedMs,
      ...(failure.queue ? { queue: failure.queue } : {}),
    });
    await delay(wait, this.options.signal);
    this.waitedMs += wait;
  }
}

/**
 * Waits as long as the server asked, plus up to half of it at random so refused clients spread
 * out, and at least the base delay so a zero Retry-After does not spin.
 */
export function waitDelay(baseDelayMs: number, retryAfterMs: number, random: () => number) {
  return Math.max(baseDelayMs, Math.floor(retryAfterMs + (random() * retryAfterMs) / 2));
}

/**
 * Pause before retry `attempt`: jittered exponential backoff, never earlier than the server's
 * Retry-After and jittered after it too, or every client the server refused returns at once.
 * A result above maxDelayMs means the retry does not fit the policy.
 */
export function retryDelay(
  policy: { readonly baseDelayMs: number; readonly maxDelayMs: number },
  attempt: number,
  retryAfterMs: number,
  random: () => number,
): number {
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = Math.floor(backoff / 2 + (random() * backoff) / 2);
  if (retryAfterMs <= 0) return jittered;
  const after = Math.min(
    Math.max(retryAfterMs, policy.maxDelayMs),
    Math.floor(retryAfterMs + (random() * retryAfterMs) / 2),
  );
  return Math.max(jittered, after);
}

export async function readNetwork(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  try {
    return await reader.read();
  } catch (error) {
    signal?.throwIfAborted();
    throw new ArkvoryNetworkError(error);
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

import { ArkvoryError } from '@proanima/arkvory-domain';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ModuleSignal, ServiceErrorCode } from '@proanima/arkvory-extension-api';
import type { Cancellation } from '@proanima/arkvory-application';

const message = 'Module refused the operation';
/** The core error of each code of the module contract; some have another name in the core. */
const CORE_ERRORS: Readonly<Record<ServiceErrorCode, () => ArkvoryError>> = {
  invalid_input: () => new ArkvoryError('invalid_input', message),
  conflict: () => new ArkvoryError('conflict', message),
  integrity_mismatch: () => new ArkvoryError('integrity_mismatch', message),
  unavailable: () => new ArkvoryError('unavailable', message),
  busy: () => new ArkvoryError('busy', message),
  read_only: () => new ArkvoryError('read_only', message),
  capacity_exceeded: () => new ArkvoryError('capacity_exceeded', message),
  module_quota_exceeded: () => new ArkvoryError('capacity_exceeded', message),
  rate_limited: () => new ArkvoryError('rate_limited', message),
  capability_unavailable: () => new ArkvoryError('unavailable', message),
  capability_invalid: () => new ArkvoryError('unavailable', message),
};

/**
 * A failure of module code as a core error: a `ModuleServiceError` keeps its meaning, a core
 * error passes, anything else is `unavailable` (the core retries, it never forwards a module's
 * message or stack to a client).
 */
export function fromModule(error: unknown): ArkvoryError {
  if (error instanceof ArkvoryError) return error;
  if (error instanceof ModuleServiceError) return CORE_ERRORS[error.code]();
  return new ArkvoryError('unavailable', 'Module failed');
}

/** Calls module code and turns its failure into a core error. */
export async function moduleCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw fromModule(error);
  }
}

/**
 * A real `AbortSignal` for module code from the core's portable cancellation, which can only be
 * asked: it is asked every `intervalMs` while the call runs, and once at the start.
 */
export async function withSignal<T>(
  cancellation: Cancellation,
  work: (signal: ModuleSignal) => Promise<T>,
  intervalMs = 250,
): Promise<T> {
  cancellation.throwIfAborted();
  const controller = new AbortController();
  const timer = setInterval(() => {
    try {
      cancellation.throwIfAborted();
    } catch (reason) {
      controller.abort(reason);
    }
  }, intervalMs);
  timer.unref();
  try {
    return await work(controller.signal);
  } finally {
    clearInterval(timer);
  }
}

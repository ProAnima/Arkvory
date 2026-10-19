import { createHash } from 'node:crypto';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ModuleSignal } from '@proanima/arkvory-extension-api';

export const CACHE_FILES = 4096;
export const CACHE_IO_BYTES = 1024 * 1024;
export const cacheLock = (kind: string, id: string): string =>
  createHash('sha256').update(`derived-cache:${kind}:${id}`).digest().readBigInt64BE().toString();
export const cacheFile = (name: string): string => createHash('sha256').update(name).digest('hex');
export const unavailable = (): ModuleServiceError => new ModuleServiceError('unavailable');

/** Bounded, single-session/handle ordering. Drain observes failures without hiding them
 * from their caller; cleanup is admitted only after new work has been stopped. */
export class CacheQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  run<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.pending >= 64) return Promise.reject(new ModuleServiceError('busy'));
    this.pending++;
    const result = this.tail.then(work).finally(() => {
      this.pending--;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  async drain(): Promise<void> {
    await this.tail;
  }
}

export interface CacheFileEntry {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface CacheBudget {
  readonly bytes: number;
  readonly files: number;
}

export function requireBudget(budget: unknown): asserts budget is CacheBudget {
  if (typeof budget !== 'object' || budget === null)
    throw new ModuleServiceError('invalid_input', 'Invalid cache reservation');
  if (
    !('bytes' in budget) ||
    typeof budget.bytes !== 'number' ||
    !('files' in budget) ||
    typeof budget.files !== 'number' ||
    !Number.isSafeInteger(budget.bytes) ||
    budget.bytes < 0 ||
    !Number.isSafeInteger(budget.files) ||
    budget.files < 3 ||
    budget.files > CACHE_FILES
  )
    throw new ModuleServiceError('invalid_input', 'Invalid cache reservation');
}

export function requireKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || Buffer.byteLength(key) > 256)
    throw new ModuleServiceError('invalid_input', 'Invalid cache key');
  for (let index = 0; index < key.length; index++)
    if (key.charCodeAt(index) < 32)
      throw new ModuleServiceError('invalid_input', 'Invalid cache key');
}

/** Abort listeners trigger cleanup, while operations still check synchronously at the I/O boundary. */
export function checkSignal(signal: ModuleSignal): void {
  signal.throwIfAborted();
}

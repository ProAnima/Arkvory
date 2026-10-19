import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ComputeMessage } from '@proanima/arkvory-extension-api';
/** Bound input/output to 16 MiB, depth 32 and 100,000 entries; reject shared memory and cycles. */
export function computeMessage(value: unknown): ComputeMessage {
  let bytes = 0;
  let entries = 0;
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number): ComputeMessage => {
    if (++entries > 100_000 || depth > 32 || bytes > 16 * 1024 ** 2)
      throw new ModuleServiceError('invalid_input');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') {
      bytes += item.length * 2;
      return item;
    }
    if (item instanceof ArrayBuffer) {
      bytes += item.byteLength;
      if (bytes > 16 * 1024 ** 2) throw new ModuleServiceError('invalid_input');
      return new Uint8Array(item).slice().buffer;
    }
    if (item instanceof Uint8Array && item.buffer instanceof ArrayBuffer) {
      bytes += item.byteLength;
      if (bytes > 16 * 1024 ** 2) throw new ModuleServiceError('invalid_input');
      return new Uint8Array(item);
    }
    if (typeof item !== 'object' || seen.has(item)) throw new ModuleServiceError('invalid_input');
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map((v: unknown) => walk(v, depth + 1));
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new ModuleServiceError('invalid_input');
      return Object.fromEntries(
        Object.entries(item).map(([k, v]) => {
          bytes += k.length * 2;
          return [k, walk(v, depth + 1)];
        }),
      );
    } finally {
      seen.delete(item);
    }
  };
  const result = walk(value, 0);
  if (bytes > 16 * 1024 ** 2) throw new ModuleServiceError('invalid_input');
  return result;
}

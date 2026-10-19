import { createHash } from 'node:crypto';
import type { BlobDescriptor, ModuleSignal } from '@proanima/arkvory-extension-api';

/** A signal that never aborts, and one that already did. */
export const neverAborted: ModuleSignal = new AbortController().signal;
export function abortedSignal(): ModuleSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

/** Concatenates every chunk of a stream. */
export async function gather(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function descriptorOf(bytes: Uint8Array): BlobDescriptor {
  return { size: bytes.byteLength, sha256: sha256(bytes) };
}

/** Deterministic test bytes: `size` bytes derived from `seed`. */
export function bytesOf(seed: string, size: number): Uint8Array {
  const result = new Uint8Array(size);
  let block = createHash('sha256').update(seed).digest();
  for (let offset = 0; offset < size; offset += block.byteLength) {
    result.set(block.subarray(0, Math.min(block.byteLength, size - offset)), offset);
    block = createHash('sha256').update(block).digest();
  }
  return result;
}

/** Whether `error` carries the machine code, as `ModuleServiceError` and core errors do. */
export function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === code;
}

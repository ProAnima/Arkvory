import { createHash, randomUUID } from 'node:crypto';
import { ArkvoryError } from '@proanima/arkvory-domain';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const chunkBytes = 64 * 1024;

async function gather(source, cancellation) {
  const chunks = [];
  for await (const chunk of source) {
    cancellation?.throwIfAborted();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * A storage without local files: the `BlobStore` port and `StorageLifecycle` over memory, for
 * consumers that must work on any storage (ADR 0083, N9). It records every range read with
 * the storage it named, so tests see what a consumer read and from where. A blob may be
 * `virtual`: a size and a function for its bytes, to stand for archives larger than memory.
 */
export class MemoryBlobStore {
  reads = [];
  #blobs = new Map();
  #parts = new Map();
  #identity = randomUUID();
  #initialized = false;

  place(id, bytes, backend = 'default') {
    this.#blobs.set(id, { backend, size: bytes.length, slice: (s, e) => bytes.subarray(s, e) });
  }
  placeVirtual(id, size, slice, backend = 'default') {
    this.#blobs.set(id, { backend, size, slice });
  }
  has(id) {
    return this.#blobs.has(id);
  }
  bytesOf(id) {
    const blob = this.#blob(id, undefined);
    return Buffer.from(blob.slice(0, blob.size));
  }
  readBytes() {
    return this.reads.reduce((total, read) => total + read.end - read.start + 1, 0);
  }

  #blob(id, backendId) {
    const blob = this.#blobs.get(id);
    if (!blob || (backendId !== undefined && blob.backend !== backendId))
      throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
    return blob;
  }

  async *read(id, size, range, backendId) {
    const blob = this.#blob(id, backendId);
    if (blob.size !== size) throw new ArkvoryError('integrity_mismatch', 'Stored size mismatch');
    const start = range?.start ?? 0,
      end = range?.end ?? size - 1;
    this.reads.push({ id, start, end, backendId });
    for (let at = start; at <= end; at += chunkBytes)
      yield Buffer.from(blob.slice(at, Math.min(end + 1, at + chunkBytes)));
  }
  async exists(id, size, backendId) {
    if (this.#blob(id, backendId).size !== size)
      throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
  }
  async verify(id, expected, cancellation, backendId) {
    const bytes = await gather(this.read(id, expected.size, undefined, backendId), cancellation);
    if (sha(bytes) !== expected.sha256)
      throw new ArkvoryError('integrity_mismatch', 'Stored content failed integrity verification');
  }
  async put(id, expected, source, cancellation, backendId = 'default') {
    const bytes = await gather(source, cancellation);
    if (bytes.length !== expected.size || sha(bytes) !== expected.sha256)
      throw new ArkvoryError('integrity_mismatch', 'Uploaded size or SHA-256 differs');
    if (this.#blobs.has(id)) return this.verify(id, expected, cancellation, backendId);
    this.place(id, bytes, backendId);
  }
  async putPart(id, part, source, cancellation) {
    const bytes = await gather(source, cancellation);
    if (bytes.length !== part.size || sha(bytes) !== part.sha256)
      throw new ArkvoryError('integrity_mismatch', 'Part differs from declaration');
    this.#parts.set(`${id}/${String(part.index)}`, bytes);
  }
  async *readParts(id, parts) {
    for (const part of parts) yield this.#parts.get(`${id}/${String(part.index)}`);
  }
  async duplicate(sourceId, targetId, expected, cancellation, backendId) {
    await this.exists(sourceId, expected.size, backendId);
    this.#blobs.set(targetId, this.#blob(sourceId, backendId));
  }
  async collect(id, removeContent) {
    for (const key of this.#parts.keys()) if (key.startsWith(`${id}/`)) this.#parts.delete(key);
    if (removeContent) this.#blobs.delete(id);
  }

  async initialize() {
    this.#initialized = true;
  }
  async identity() {
    return this.#identity;
  }
  async ready() {
    if (!this.#initialized) throw new ArkvoryError('unavailable', 'Storage is not initialized');
  }
  async checkSpace() {}
  async requireEmpty() {
    if (this.#blobs.size || this.#parts.size)
      throw new ArkvoryError('conflict', 'Storage is not empty', { reason: 'already_exists' });
  }
}

/** Only the port of a store, as a module would see it: no root, no paths, no lifecycle. */
export function portOnly(store) {
  const methods = ['putPart', 'readParts', 'put', 'verify', 'read', 'exists', 'duplicate'];
  const port = Object.fromEntries(methods.map((name) => [name, store[name].bind(store)]));
  port.collect = store.collect.bind(store);
  return Object.freeze(port);
}

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { UploadResponse } from '@proanima/arkvory-contracts';
import {
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
  readNetwork,
  releaseReader,
} from './transfer.js';
import type { TransferAttempts } from './transfer.js';

const chunkBytes = 8 * 1024 ** 2;

/** The 206 answer of exactly `start`-`end` of the artifact with SHA-256 `digest`, read whole. */
export async function readRange(
  response: Response,
  start: number,
  end: number,
  total: number,
  digest: string,
  signal: AbortSignal,
) {
  const length = end - start + 1;
  const encoding = response.headers.get('content-encoding');
  if (
    response.status !== 206 ||
    response.headers.get('etag') !== `"sha256:${digest}"` ||
    response.headers.get('content-range') !==
      `bytes ${String(start)}-${String(end)}/${String(total)}` ||
    response.headers.get('content-length') !== String(length) ||
    (encoding !== null && encoding !== 'identity') ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new ArkvoryIntegrityError();
  }
  const bytes = new Uint8Array(length);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const result = await readNetwork(reader, signal);
      if (result.done) break;
      if (received + result.value.length > length) throw new ArkvoryIntegrityError();
      bytes.set(result.value, received);
      received += result.value.length;
    }
    if (received !== length) throw new ArkvoryNetworkError();
    return bytes;
  } finally {
    await releaseReader(reader);
  }
}

/**
 * Bytes a transfer extension yields from the current offset (ADR 0079, 5.2). The SDK hashes and
 * counts them like its own; when the stream fails or ends early, `takeOver` decides whether the
 * core transfer continues from the offset reached (true) or the download fails with it.
 */
export interface ExtensionStream {
  readonly iterator: AsyncIterator<unknown>;
  takeOver(reason: 'failed' | 'incomplete', failure: unknown): boolean;
}

/** The next chunk of the extension, `end` at the exact size, or null once the core takes over. */
async function extensionStep(
  stream: ExtensionStream,
  offset: number,
  size: number,
): Promise<Uint8Array | 'end' | null> {
  let failure: unknown;
  let reason: 'failed' | 'incomplete' = 'failed';
  try {
    const result = await stream.iterator.next();
    if (result.done !== true) {
      const value = result.value;
      // More bytes than the artifact has, or not bytes at all: the extension's output is wrong,
      // and what it already gave cannot be taken back.
      if (!(value instanceof Uint8Array) || offset + value.length > size)
        throw new ArkvoryIntegrityError();
      // A copy: the extension keeps its own reference and could change the bytes after they
      // were hashed, while the consumer still holds them.
      return new Uint8Array(value);
    }
    if (offset === size) return 'end';
    reason = 'incomplete';
    failure = new ArkvoryIntegrityError();
  } catch (error) {
    if (error instanceof ArkvoryIntegrityError) throw error;
    failure = error;
  }
  void Promise.resolve(stream.iterator.return?.()).catch(() => undefined);
  if (!stream.takeOver(reason, failure)) throw failure;
  return null;
}

export async function verifiedDownload(
  artifact: UploadResponse,
  prefix: Blob | undefined,
  attempts: TransferAttempts,
  signal: AbortSignal,
  cancellation: AbortController,
  request: (start: number, end: number, signal: AbortSignal) => Promise<Response>,
  extension?: ExtensionStream,
): Promise<ReadableStream<Uint8Array>> {
  const size = Number(artifact.descriptor.size);
  if (
    artifact.status !== 'available' ||
    !/^(0|[1-9]\d*)$/.test(artifact.descriptor.size) ||
    !Number.isSafeInteger(size) ||
    !/^[a-f0-9]{64}$/.test(artifact.descriptor.sha256)
  )
    throw new ArkvoryIntegrityError();
  let offset = prefix?.size ?? 0;
  if (offset > size) throw new ArkvoryIntegrityError();
  const hash = sha256.create();
  // Rehash saved bytes instead of trusting a persisted hash state or offset journal.
  if (prefix) {
    for (let start = 0; start < prefix.size; start += 1024 ** 2) {
      signal.throwIfAborted();
      hash.update(new Uint8Array(await prefix.slice(start, start + 1024 ** 2).arrayBuffer()));
    }
  }
  const verify = () => {
    if (bytesToHex(hash.digest()) !== artifact.descriptor.sha256) throw new ArkvoryIntegrityError();
  };
  let source = extension;
  const accept = (bytes: Uint8Array, stream: ReadableStreamDefaultController<Uint8Array>) => {
    hash.update(bytes);
    offset += bytes.length;
    if (offset === size) verify();
    stream.enqueue(bytes);
    if (offset !== size) return;
    stream.close();
    void Promise.resolve(source?.iterator.return?.()).catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(stream) {
        try {
          signal.throwIfAborted();
          if (offset === size) {
            verify();
            stream.close();
            return;
          }
          if (source) {
            const step = await extensionStep(source, offset, size);
            signal.throwIfAborted();
            if (step === 'end') {
              verify();
              stream.close();
              return;
            }
            if (step !== null) {
              accept(step, stream);
              return;
            }
            source = undefined;
          }
          const end = Math.min(size, offset + chunkBytes) - 1;
          const bytes = await attempts.run(async (attemptSignal) =>
            readRange(
              await request(offset, end, attemptSignal),
              offset,
              end,
              size,
              artifact.descriptor.sha256,
              attemptSignal,
            ),
          );
          signal.throwIfAborted();
          accept(bytes, stream);
        } catch (error) {
          void Promise.resolve(source?.iterator.return?.()).catch(() => undefined);
          hash.destroy();
          stream.error(error);
        }
      },
      cancel() {
        void Promise.resolve(source?.iterator.return?.()).catch(() => undefined);
        cancellation.abort();
        hash.destroy();
      },
    },
    { highWaterMark: 0 },
  );
}

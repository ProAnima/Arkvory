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

async function readRange(
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

export async function verifiedDownload(
  artifact: UploadResponse,
  prefix: Blob | undefined,
  attempts: TransferAttempts,
  signal: AbortSignal,
  cancellation: AbortController,
  request: (start: number, end: number, signal: AbortSignal) => Promise<Response>,
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
          hash.update(bytes);
          offset += bytes.length;
          if (offset === size) verify();
          stream.enqueue(bytes);
          if (offset === size) stream.close();
        } catch (error) {
          hash.destroy();
          stream.error(error);
        }
      },
      cancel() {
        cancellation.abort();
        hash.destroy();
      },
    },
    { highWaterMark: 0 },
  );
}

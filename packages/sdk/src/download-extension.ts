import type { UploadResponse } from '@proanima/arkvory-contracts';
import type { TransferExtensions } from './transfer-extensions.js';
import { ArkvoryClientError } from './transfer.js';
import type { ExtensionStream } from './verified-download.js';

/** The largest range one `readRange` call of an extension may ask for. */
const MAX_EXTENSION_RANGE = 64 * 1024 ** 2;

function isIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  );
}

/**
 * Asks the agreed transfer extension for the content from `offset` on (ADR 0079, 5.2). Returns
 * undefined when the core transfer does the download: no extension fits, it declined, or it
 * failed to start in `auto` mode. The returned stream's bytes are verified by the caller.
 */
export async function extensionDownload(
  extensions: TransferExtensions,
  input: {
    readonly repository: string;
    readonly artifactId: string;
    readonly artifact: UploadResponse;
    readonly offset: number;
    readonly signal: AbortSignal;
    readonly readRange: (start: number, end: number, signal: AbortSignal) => Promise<Uint8Array>;
  },
): Promise<ExtensionStream | undefined> {
  const { signal } = input;
  const chosen = await extensions.choose('download', signal);
  const extension = chosen?.extension;
  if (!chosen || !extension?.download) {
    extensions.report({ operation: 'download', extension: null });
    return undefined;
  }
  const { offer } = chosen;
  const fallback = (reason: 'declined' | 'failed' | 'incomplete') => {
    extensions.report({ operation: 'download', extension: null, fallback: reason });
  };
  let iterable: unknown;
  try {
    iterable = await extension.download(
      {
        offer,
        channel: extensions.channel(offer),
        repository: input.repository,
        artifactId: input.artifactId,
        size: input.artifact.descriptor.size,
        sha256: input.artifact.descriptor.sha256,
        offset: input.offset,
        readRange: (start, end, rangeSignal) => {
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start ||
            end >= Number(input.artifact.descriptor.size) ||
            end - start + 1 > MAX_EXTENSION_RANGE
          )
            throw new ArkvoryClientError('invalid_argument', 'Invalid extension range');
          const own = rangeSignal instanceof AbortSignal ? rangeSignal : signal;
          return input.readRange(start, end, AbortSignal.any([signal, own]));
        },
      },
      signal,
    );
    if (iterable !== null && !isIterable(iterable))
      throw new ArkvoryClientError('invalid_response', 'Transfer extension returned no stream');
  } catch (error) {
    if (!extensions.fallsBack(error, signal)) throw error;
    fallback('failed');
    return undefined;
  }
  if (!isIterable(iterable)) {
    if (extensions.mode === 'strict')
      throw new ArkvoryClientError('transfer_unavailable', 'The transfer extension declined');
    fallback('declined');
    return undefined;
  }
  extensions.report({
    operation: 'download',
    extension: { name: offer.name, version: offer.version },
  });
  return {
    iterator: iterable[Symbol.asyncIterator](),
    takeOver: (reason, failure) => {
      if (!extensions.fallsBack(failure, signal)) return false;
      fallback(reason);
      return true;
    },
  };
}

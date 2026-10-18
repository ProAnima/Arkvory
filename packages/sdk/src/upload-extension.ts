import type { UploadResponse } from '@proanima/arkvory-contracts';
import type { TransferExtensions } from './transfer-extensions.js';
import { ArkvoryClientError, ArkvoryIntegrityError } from './transfer.js';

/** The largest range one `read` call of an extension may ask for. */
const MAX_EXTENSION_READ = 64 * 1024 ** 2;

/**
 * Lets the agreed transfer extension deliver a pending upload its own way (ADR 0079, 5.2).
 * True: the extension says the server's module holds the content, and the caller finishes the
 * upload the core way (sending whatever is still missing, then completing it, which verifies
 * the bytes on the server). False: the core transfer does it all.
 */
export async function extensionUpload(
  extensions: TransferExtensions,
  input: {
    readonly repository: string;
    readonly uploadId: string;
    readonly upload: UploadResponse;
    readonly file: Blob;
    readonly signal: AbortSignal | undefined;
  },
): Promise<boolean> {
  const signal = input.signal ?? new AbortController().signal;
  const chosen = await extensions.choose('upload', signal);
  const extension = chosen?.extension;
  if (!chosen || !extension?.upload) {
    extensions.report({ operation: 'upload', extension: null });
    return false;
  }
  const { offer } = chosen;
  try {
    // Read as unknown: an extension written in JavaScript may return anything.
    const sent: unknown = await extension.upload(
      {
        offer,
        channel: extensions.channel(offer),
        repository: input.repository,
        uploadId: input.uploadId,
        size: input.upload.descriptor.size,
        sha256: input.upload.descriptor.sha256,
        read: async (start, end) => {
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start ||
            end >= input.file.size ||
            end - start + 1 > MAX_EXTENSION_READ
          )
            throw new ArkvoryClientError('invalid_argument', 'Invalid extension range');
          return new Uint8Array(await input.file.slice(start, end + 1).arrayBuffer());
        },
      },
      signal,
    );
    if (sent === true) {
      extensions.report({
        operation: 'upload',
        extension: { name: offer.name, version: offer.version },
      });
      return true;
    }
    if (extensions.mode === 'strict')
      throw new ArkvoryClientError('transfer_unavailable', 'The transfer extension declined');
    extensions.report({ operation: 'upload', extension: null, fallback: 'declined' });
    return false;
  } catch (error) {
    if (!extensions.fallsBack(error, signal)) throw error;
    extensions.report({ operation: 'upload', extension: null, fallback: 'failed' });
    return false;
  }
}

/**
 * The published upload must name exactly the content that was asked for: the SDK checks it
 * itself whichever way the bytes travelled.
 */
export function publishedAsRequested(result: UploadResponse, requested: UploadResponse) {
  if (
    result.status !== 'available' ||
    result.descriptor.size !== requested.descriptor.size ||
    result.descriptor.sha256 !== requested.descriptor.sha256
  )
    throw new ArkvoryIntegrityError();
  return result;
}

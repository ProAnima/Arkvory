import { ArkvoryError, DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import type { Upload, UploadPart } from '@proanima/arkvory-domain';
import type { Cancellation, StagedParts } from './ports.js';

/** The storage that holds an upload's parts: where they were written, even after a switch. */
export function partsBackendOf(upload: Upload): string {
  return upload.partsBackend ?? upload.storageBackend ?? DEFAULT_STORAGE_BACKEND;
}

/**
 * Completion from parts the upload's storage accepted (ADR 0083, N1): the storage assembles the
 * object, the core reads it all and checks size and SHA-256 itself, then the storage commits
 * it, and only then the caller publishes it in the catalog (blob durable before catalog). A
 * mismatch or a failure before the commit discards the assembled object; the parts stay and
 * the upload stays pending. A retry after a crash between commit and publication composes
 * the committed object again and checks it again. `skipped` when the storage has no composer
 * or the parts are elsewhere; `refused` when it is read-only now: the object then goes to the
 * core's storage like any upload of a storage that stopped taking data.
 */
export async function completeFromParts(
  staged: StagedParts | undefined,
  upload: Upload,
  parts: readonly UploadPart[],
  check: Cancellation,
): Promise<'committed' | 'skipped' | 'refused'> {
  const backend = upload.storageBackend ?? DEFAULT_STORAGE_BACKEND;
  const composer = partsBackendOf(upload) === backend ? staged?.composer(backend) : null;
  if (!composer) return 'skipped';
  let object;
  try {
    object = await composer.compose(upload.id, parts, check);
  } catch (error) {
    if (
      error instanceof ArkvoryError &&
      error.code === 'read_only' &&
      backend !== DEFAULT_STORAGE_BACKEND
    )
      return 'refused';
    throw error;
  }
  try {
    await object.verify(upload.descriptor, check);
    check.throwIfAborted();
    await object.commit(upload.descriptor, check);
  } catch (error) {
    // After a failed commit the outcome may be unknown; the parts stay, so a retry composes
    // again whether or not the storage kept the object.
    await object.discard().catch(() => undefined);
    throw error;
  }
  return 'committed';
}

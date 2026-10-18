import { createHash } from 'node:crypto';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, UploadPart } from '@proanima/arkvory-domain';
import type { StagedCompletion, StagedObject } from '@proanima/arkvory-extension-api';
import type { Cancellation, ComposedObject, PartComposer } from '@proanima/arkvory-application';
import { moduleCall, withSignal } from './module-errors.js';

const mismatch = () =>
  new ArkvoryError('integrity_mismatch', 'Composed size or SHA-256 differs from declaration');

/**
 * Reads the whole composed object and measures it in the core (ADR 0083, N1; ADR 0078, L6): the
 * size the storage reports is only a first check, a longer or shorter stream is refused early.
 */
async function measure(
  object: StagedObject,
  expected: ArtifactDescriptor,
  cancellation: Cancellation,
): Promise<void> {
  if (object.size !== expected.size) throw mismatch();
  const hash = createHash('sha256');
  let size = 0;
  await moduleCall(async () => {
    for await (const chunk of object.read()) {
      cancellation.throwIfAborted();
      size += chunk.byteLength;
      if (size > expected.size) throw mismatch();
      hash.update(chunk);
    }
  });
  cancellation.throwIfAborted();
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw mismatch();
}

/**
 * The core's side of a storage's `StagedCompletion`: module errors become core errors, the
 * portable cancellation becomes a signal, and `commit` runs inside `guard`, which proves the
 * storage is still the one that was opened before and after the write.
 */
export function stagedComposer(
  completion: StagedCompletion,
  guard: (work: () => Promise<void>) => Promise<void>,
): PartComposer {
  return {
    async compose(id: string, parts: readonly UploadPart[], cancellation: Cancellation) {
      const refs = parts.map(({ index, size, sha256 }) => ({ index, size, sha256 }));
      const object = await withSignal(cancellation, (signal) =>
        moduleCall(() => completion.compose(id, refs, signal)),
      );
      const composed: ComposedObject = {
        verify: (expected, check) => measure(object, expected, check),
        commit: (expected, check) =>
          guard(() =>
            withSignal(check, (signal) =>
              moduleCall(() =>
                object.commit({ size: expected.size, sha256: expected.sha256 }, signal),
              ),
            ),
          ),
        discard: () => moduleCall(() => object.discard()),
      };
      return composed;
    },
  };
}

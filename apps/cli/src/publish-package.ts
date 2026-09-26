import { upload } from './upload.js';
import type { UploadInput } from './upload.js';
import { PublicationError } from './errors.js';

/** Upload receipts survive registration failure; repeating the command reuses the same artifact. */
export async function publishPackage(input: UploadInput) {
  const artifact = await upload(input);
  try {
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(input.requestTimeoutMs ?? 60000),
    ]);
    const entry = await input.client.registerPackage(input.repository, artifact.id, signal);
    return { artifactId: artifact.id, package: entry, checkpoint: artifact.checkpoint };
  } catch (error) {
    throw new PublicationError(artifact.id, error);
  }
}

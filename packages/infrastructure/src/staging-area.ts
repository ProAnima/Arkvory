import { join, resolve } from 'node:path';

/** The temporary areas of the core on the data volume; each has one owner. */
export type StagingName = 'raw-staging' | 'oci-uploads' | 'mirror-staging';

/**
 * Temporary files of the core on the data volume (ADR 0079, 5.1; ADR 0083, N9), apart from
 * any storage layout: a storage without local files still has this volume. Each consumer
 * creates, uses and clears only its own directory. On the volume of a `LocalBlobStore` a
 * staged file can become the blob without a copy (ADR 0074); any other store copies it.
 */
export interface StagingArea {
  directory(name: StagingName): string;
  /** Fails with `capacity_exceeded` unless `bytes` more fit beside the volume's reserve. */
  checkSpace(bytes: number): Promise<void>;
}

export function dataVolumeStaging(
  dataDirectory: string,
  checkSpace: (bytes: number) => Promise<void>,
): StagingArea {
  // An empty root would resolve against the working directory of the process.
  if (dataDirectory === '') throw new Error('The data directory is not set');
  const root = resolve(dataDirectory);
  return { directory: (name) => join(root, name), checkSpace };
}

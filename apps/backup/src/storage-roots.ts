import { BackupFailure } from '@proanima/arkvory-domain';
import { readLocalStorageSettings, requireSeparateTrees } from '@proanima/arkvory-infrastructure';
import type { LocalStorageSettings } from '@proanima/arkvory-infrastructure';

/** The `local-storage` volumes of the source installation (ADR 0083, N11) in its modules file. */
export async function sourceVolumes(
  dataDirectory: string,
  modulesFile: string | undefined,
): Promise<readonly LocalStorageSettings[]> {
  try {
    return await readLocalStorageSettings(modulesFile, dataDirectory);
  } catch (error) {
    throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_MODULES_FILE', { cause: error });
  }
}

/** Every directory that holds content of the source: ARKVORY_DATA_DIR and each volume. */
export async function sourceStorageRoots(
  dataDirectory: string,
  modulesFile: string | undefined,
): Promise<readonly string[]> {
  const volumes = await sourceVolumes(dataDirectory, modulesFile);
  return [dataDirectory, ...volumes.map((volume) => volume.directory)];
}

/**
 * A vault inside a storage directory or a volume (or containing one) would be lost, or copied
 * into itself, together with it: refused before anything is written, as a restore target is.
 */
export async function requireVaultApart(
  vaultRoot: string,
  storageRoots: readonly string[],
): Promise<void> {
  for (const [index, path] of storageRoots.entries())
    await requireSeparateTrees(
      { label: 'vault', path: vaultRoot },
      { label: index === 0 ? 'storage root' : 'storage volume', path },
    );
}

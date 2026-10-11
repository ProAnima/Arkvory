import { mkdir, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { BackupFailure, idPattern } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { Cancellation } from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';
import { encryptedSize } from './vault-crypto.js';
import type { FileCipher } from './vault-crypto.js';
import { VAULT_DIRECTORY_MODE, writeDurably } from './vault-files.js';

const MAX_POINTS = 10000;
const pointName = new RegExp(idPattern);

/**
 * The committed point IDs of a vault, sorted. A vault with more than a listing holds is refused,
 * never listed in part: prune keeps only the blobs of listed points and would delete the rest.
 */
export async function listPointIds(root: string): Promise<readonly string[]> {
  const names = (await readdir(join(root, 'points'))).filter((name) => pointName.test(name));
  if (names.length > MAX_POINTS)
    throw new BackupFailure(
      'unavailable',
      `The vault holds more than ${String(MAX_POINTS)} points; remove old points first`,
    );
  return names.sort();
}

/**
 * Writes one blob below `blobs/<first two hex>/`. Free space is checked before every object, so
 * a volume that disappears mid-capture fails the write. A new shard directory is synced into
 * `blobs/` before a point can refer to a blob inside it.
 */
export async function writeVaultBlob(
  root: string,
  path: string,
  entry: InventoryEntry,
  source: AsyncIterable<Uint8Array>,
  options: {
    readonly cipher: FileCipher | undefined;
    readonly reserveBytes: number;
    readonly cancellation: Cancellation;
  },
): Promise<void> {
  const { cipher } = options;
  const needed = BigInt(cipher ? encryptedSize(entry.size) : entry.size);
  const volume = await statfs(root, { bigint: true });
  if (volume.bavail * volume.bsize < needed + BigInt(options.reserveBytes))
    throw new BackupFailure('vault_full', 'Not enough free space on the vault volume');
  const shard = join(root, 'blobs', entry.id.slice(0, 2));
  try {
    await mkdir(shard, { mode: VAULT_DIRECTORY_MODE });
    await syncDirectory(join(root, 'blobs'));
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  await writeDurably(path, source, {
    cancellation: options.cancellation,
    expected: entry,
    ...(cipher ? { cipher } : {}),
  });
}

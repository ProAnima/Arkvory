import { statfs } from 'node:fs/promises';
import { ArkvoryError } from '@proanima/arkvory-domain';

/** What a volume keeps free for the database, logs and the OS (ADR 0083, N6). */
export interface VolumeReserve {
  /** ARKVORY_STORAGE_RESERVE_BYTES. */
  readonly bytes: number;
  /** ARKVORY_STORAGE_RESERVE_INODES. */
  readonly inodes: number;
}

/** Free space of a volume as `statfs` reports it; injectable for tests of a full volume. */
export type VolumeProbe = (
  path: string,
) => Promise<{ bavail: bigint; bsize: bigint; files: bigint; ffree: bigint }>;

export const statVolume: VolumeProbe = (path) => statfs(path, { bigint: true });

/**
 * Fails with `capacity_exceeded` (reason `storage_full`) unless `bytes` more fit beside the
 * reserve and the free inodes stay at least the reserve: every blob and part is a file, so a
 * volume may run out of inodes before bytes. A file system without an inode count (NTFS, some
 * network file systems) reports zero files; only the bytes are checked there.
 */
export async function requireVolumeRoom(
  path: string,
  bytes: number,
  reserve: VolumeReserve,
  probe: VolumeProbe = statVolume,
): Promise<void> {
  const volume = await probe(path);
  const full = () =>
    new ArkvoryError('capacity_exceeded', 'Insufficient storage capacity', {
      reason: 'storage_full',
    });
  if (volume.bavail * volume.bsize < BigInt(bytes) + BigInt(reserve.bytes)) throw full();
  if (volume.files > 0n && volume.ffree < BigInt(reserve.inodes)) throw full();
}

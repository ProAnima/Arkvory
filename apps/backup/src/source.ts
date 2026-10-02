import { randomUUID } from 'node:crypto';
import { BackupFailure } from '@proanima/arkvory-domain';
import { defaultCaptureLimits } from '@proanima/arkvory-application';
import type { CaptureDependencies, CaptureEvent } from '@proanima/arkvory-application';
import {
  FileVault,
  LocalBlobStore,
  LocalContentSource,
  PacedContentSource,
  PostgresBackupJobs,
  PostgresCapturePins,
  PostgresSnapshotSource,
  PostgresUnlinkBarrier,
  SCHEMA_VERSION,
  appliedSchemaVersion,
  backupPool,
  claimBackupSource,
  requireSeparateTrees,
} from '@proanima/arkvory-infrastructure';
import type { BackupPool } from '@proanima/arkvory-infrastructure';
import type { SourceConfig } from './config.js';

export interface CaptureSource {
  readonly pool: BackupPool;
  readonly blobs: LocalBlobStore;
  readonly storageId: string;
  /** False once the capture session (maintenance and singleton locks) is lost. */
  readonly active: () => boolean;
  close(): Promise<void>;
}

/**
 * Read-only binding to the running instance: the storage-id file must match the database and
 * the schema must be this release's. The capture session holds 18471/4 shared and 18471/19.
 */
export async function openCaptureSource(config: SourceConfig): Promise<CaptureSource> {
  const blobs = new LocalBlobStore(config.dataDirectory, config.reserveBytes);
  let storageId: string;
  try {
    await blobs.ready();
    storageId = await blobs.identity(true);
  } catch (error) {
    throw new BackupFailure('storage_mismatch', 'ARKVORY_DATA_DIR is not an initialized storage', {
      cause: error,
    });
  }
  const pool = backupPool(config.databaseUrl, 6);
  try {
    if ((await appliedSchemaVersion(pool)) !== SCHEMA_VERSION)
      throw new BackupFailure('schema_mismatch', 'Source schema differs from this release');
    const session = await claimBackupSource(pool, storageId);
    return {
      pool,
      blobs,
      storageId,
      active: () => session.active,
      close: async () => {
        await session.close();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

/** Opens a vault and proves its identity; refuses a vault overlapping the storage root. */
export async function openVault(directory: string, storageRoot?: string): Promise<FileVault> {
  const vault = await FileVault.open(directory);
  if (storageRoot !== undefined)
    await requireSeparateTrees(
      { label: 'vault', path: vault.root },
      { label: 'storage root', path: storageRoot },
    );
  await vault.identity();
  return vault;
}

/** The single capture composition, shared by the CLI and acceptance tests. */
export function captureDependencies(
  source: CaptureSource,
  vault: FileVault,
  options: {
    readonly config: SourceConfig;
    readonly release: { readonly version: string; readonly commit: string | null };
    readonly progress?: (event: CaptureEvent) => void;
    /** Copy bandwidth cap of the agent (ARKVORY_BACKUP_BYTES_PER_SECOND); absent: unlimited. */
    readonly bytesPerSecond?: number | null;
  },
): CaptureDependencies {
  const { config, bytesPerSecond } = options;
  const content = new LocalContentSource(source.blobs);
  return {
    jobs: new PostgresBackupJobs(source.pool, {
      owner: randomUUID(),
      leaseSeconds: config.leaseSeconds,
    }),
    barrier: new PostgresUnlinkBarrier(source.pool, { waitMs: config.barrierSeconds * 1000 }),
    pins: new PostgresCapturePins(source.pool),
    snapshots: new PostgresSnapshotSource(source.pool),
    content: bytesPerSecond ? new PacedContentSource(content, bytesPerSecond) : content,
    vault,
    identity: { next: () => randomUUID(), now: () => new Date().toISOString() },
    release: options.release,
    limits: { ...defaultCaptureLimits, snapshotMilliseconds: config.snapshotSeconds * 1000 },
    ...(options.progress ? { progress: options.progress } : {}),
  };
}

import { open } from 'node:fs/promises';
import { BackupFailure } from '@proanima/arkvory-domain';
import { RestoreToEmptyTarget } from '@proanima/arkvory-application';
import type { RestoreReport } from '@proanima/arkvory-application';
import {
  localStorageBackends,
  LocalRestoreStorage,
  MINIMUM_RESTORE_SCHEMA,
  PostgresRestoreDatabase,
  RESTORE_NORMALIZATION_VERSION,
  SCHEMA_VERSION,
  backupPool,
  readLocalStorageSettings,
  requireSeparateTrees,
} from '@proanima/arkvory-infrastructure';
import type { LocalStorageSettings } from '@proanima/arkvory-infrastructure';
import type { BackupCommand } from './arguments.js';
import type { CliContext } from './context.js';
import { databaseUrl, restoreReserveBytes } from './config.js';
import { sourceStorageRoots } from './storage-roots.js';
import { openVault, vaultKeys } from './source.js';

type RestoreCommand = Extract<BackupCommand, { kind: 'restore' }>;

/** The report holds identifiers and counts only; never paths, URLs or credentials. */
async function writeReport(path: string, report: RestoreReport, context: CliContext) {
  const document = {
    format: 'arkvory-restore-report',
    version: 1,
    release: context.release,
    normalizationVersion: RESTORE_NORMALIZATION_VERSION,
    ...report,
  };
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(document, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * The other storages of the target (ADR 0083, N11): the `local-storage` instances of the
 * target's modules file; none without `--modules-file`.
 */
async function targetBackends(command: RestoreCommand): Promise<readonly LocalStorageSettings[]> {
  try {
    return await readLocalStorageSettings(command.modulesFile, command.storage);
  } catch (error) {
    throw new BackupFailure('invalid_argument', 'Invalid --modules-file', {
      cause: error,
    });
  }
}

async function requireSeparateTargets(
  targets: readonly string[],
  vaultRoot: string,
  env: NodeJS.ProcessEnv,
) {
  const source = env['ARKVORY_DATA_DIR'];
  // The source's own storage directory and volumes, when this host runs the source too.
  const sources = source
    ? await sourceStorageRoots(source, env['ARKVORY_MODULES_FILE'] || undefined)
    : [];
  for (const target of targets) {
    await requireSeparateTrees(
      { label: 'vault', path: vaultRoot },
      { label: 'restore storage', path: target },
    );
    for (const path of sources)
      await requireSeparateTrees(
        { label: 'source storage root', path },
        { label: 'restore storage', path: target },
      );
  }
}

export async function runRestore(command: RestoreCommand, context: CliContext): Promise<number> {
  const url = databaseUrl(
    command.databaseUrl ?? context.env['ARKVORY_RESTORE_DATABASE_URL'],
    'restore database URL (--database-url or ARKVORY_RESTORE_DATABASE_URL)',
  );
  const vault = await openVault(command.vault, undefined, vaultKeys(command.keyFile, context.env));
  const backends = await targetBackends(command);
  await requireSeparateTargets(
    [command.storage, ...backends.map((backend) => backend.directory)],
    vault.root,
    context.env,
  );
  const started = performance.now();
  const pool = backupPool(url, 3);
  try {
    const restore = new RestoreToEmptyTarget({
      vault,
      database: new PostgresRestoreDatabase(pool),
      // The target's roots are created private (0700): they hold the restored content.
      storage: new LocalRestoreStorage(
        localStorageBackends(command.storage, restoreReserveBytes(context.env), backends, {
          rootMode: 0o700,
          createVolumeRoots: true,
        }),
      ),
      identity: { now: () => new Date().toISOString() },
      releaseSchema: SCHEMA_VERSION,
      minimumSchema: MINIMUM_RESTORE_SCHEMA,
      progress: (phase) => {
        context.logger.write({
          level: 'info',
          component: 'backup',
          code: 'backup.restore.phase',
          pointId: command.pointId,
          phase,
        });
      },
    });
    const report = await restore.run(
      { pointId: command.pointId, confirmed: command.confirmed },
      context.cancellation,
    );
    context.logger.write({
      level: 'info',
      component: 'backup',
      code: report.outcome === 'planned' ? 'backup.restore.planned' : 'backup.restore.completed',
      pointId: report.pointId,
      outcome: report.outcome,
      snapshotAt: report.snapshotAt,
      schemaVersion: report.schemaVersion,
      blobs: report.blobs,
      contentBytes: report.contentBytes,
      tables: report.tables,
      rows: report.rows,
      ...(report.outcome === 'restored' ? report.normalization : {}),
      durationMs: Math.round(performance.now() - started),
    });
    if (command.report !== undefined) await writeReport(command.report, report, context);
    return 0;
  } finally {
    await pool.end();
  }
}

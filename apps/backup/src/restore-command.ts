import { open } from 'node:fs/promises';
import { RestoreToEmptyTarget } from '@proanima/arkvory-application';
import type { RestoreReport } from '@proanima/arkvory-application';
import {
  LocalRestoreStorage,
  MINIMUM_RESTORE_SCHEMA,
  PostgresRestoreDatabase,
  RESTORE_NORMALIZATION_VERSION,
  SCHEMA_VERSION,
  backupPool,
  requireSeparateTrees,
} from '@proanima/arkvory-infrastructure';
import type { BackupCommand } from './arguments.js';
import type { CliContext } from './context.js';
import { databaseUrl, restoreReserveBytes } from './config.js';
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

async function requireSeparateTargets(
  command: RestoreCommand,
  vaultRoot: string,
  env: NodeJS.ProcessEnv,
) {
  await requireSeparateTrees(
    { label: 'vault', path: vaultRoot },
    { label: 'restore storage', path: command.storage },
  );
  const source = env['ARKVORY_DATA_DIR'];
  if (source)
    await requireSeparateTrees(
      { label: 'source storage root', path: source },
      { label: 'restore storage', path: command.storage },
    );
}

export async function runRestore(command: RestoreCommand, context: CliContext): Promise<number> {
  const url = databaseUrl(
    command.databaseUrl ?? context.env['ARKVORY_RESTORE_DATABASE_URL'],
    'restore database URL (--database-url or ARKVORY_RESTORE_DATABASE_URL)',
  );
  const vault = await openVault(command.vault, undefined, vaultKeys(command.keyFile, context.env));
  await requireSeparateTargets(command, vault.root, context.env);
  const started = performance.now();
  const pool = backupPool(url, 3);
  try {
    const restore = new RestoreToEmptyTarget({
      vault,
      database: new PostgresRestoreDatabase(pool),
      storage: new LocalRestoreStorage(command.storage, restoreReserveBytes(context.env)),
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

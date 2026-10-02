import { randomUUID } from 'node:crypto';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
import { VerifyPoint } from '@proanima/arkvory-application';
import { FileVault, requireSeparateTrees } from '@proanima/arkvory-infrastructure';
import type { BackupCommand } from './arguments.js';
import type { CliContext } from './context.js';
import { openVault } from './source.js';

export async function runVaultInit(
  command: Extract<BackupCommand, { kind: 'vault-init' }>,
  context: CliContext,
): Promise<number> {
  const storage = context.env['ARKVORY_DATA_DIR'];
  if (storage)
    await requireSeparateTrees(
      { label: 'vault', path: command.vault },
      { label: 'storage root', path: storage },
    );
  const identity = await FileVault.initialize(command.vault, {
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  context.logger.write({
    level: 'info',
    component: 'backup',
    code: 'backup.vault.initialized',
    vaultId: identity.vaultId,
  });
  return 0;
}

export async function runList(
  command: Extract<BackupCommand, { kind: 'list' }>,
  context: CliContext,
): Promise<number> {
  const vault = await openVault(command.vault);
  const manifests: BackupManifest[] = [];
  let damaged = 0;
  for (const pointId of await vault.pointIds()) {
    try {
      const manifest = await vault.point(pointId);
      if (manifest) manifests.push(manifest);
    } catch (error) {
      if (!(error instanceof BackupFailure) || error.code !== 'invalid_manifest') throw error;
      damaged++;
      context.logger.write({
        level: 'warning',
        component: 'backup',
        code: 'backup.point.invalid',
        pointId,
        errorCode: error.code,
      });
    }
  }
  manifests.sort((a, b) => b.snapshot.takenAt.localeCompare(a.snapshot.takenAt));
  for (const manifest of manifests)
    context.logger.write({
      level: 'info',
      component: 'backup',
      code: 'backup.point',
      pointId: manifest.pointId,
      jobId: manifest.jobId,
      snapshotAt: manifest.snapshot.takenAt,
      schemaVersion: manifest.schemaVersion,
      blobs: manifest.inventory.count,
      contentBytes: manifest.inventory.contentBytes,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
    });
  context.logger.write({
    level: 'info',
    component: 'backup',
    code: 'backup.list.completed',
    checked: manifests.length,
    failed: damaged,
  });
  return 0;
}

export async function runVerify(
  command: Extract<BackupCommand, { kind: 'verify' }>,
  context: CliContext,
): Promise<number> {
  const vault = await openVault(command.vault);
  const results = await new VerifyPoint(vault).run(
    command.pointId === undefined
      ? { deep: command.deep }
      : { pointId: command.pointId, deep: command.deep },
    context.cancellation,
  );
  let failed = 0;
  for (const result of results) {
    if (!result.ok) failed++;
    for (const problem of result.problems)
      context.logger.write({
        level: 'error',
        component: 'backup',
        code: 'backup.verify.problem',
        pointId: result.pointId,
        errorCode: problem.code,
        subject: problem.subject,
      });
    context.logger.write({
      level: result.ok ? 'info' : 'error',
      component: 'backup',
      code: 'backup.verify.point',
      pointId: result.pointId,
      outcome: result.ok ? 'verified' : 'damaged',
      depth: result.deep ? 'deep' : 'structural',
      blobs: result.blobs,
      problems: result.problems.length,
    });
  }
  context.logger.write({
    level: failed ? 'error' : 'info',
    component: 'backup',
    code: 'backup.verify.completed',
    checked: results.length,
    failed,
  });
  return failed ? 4 : 0;
}

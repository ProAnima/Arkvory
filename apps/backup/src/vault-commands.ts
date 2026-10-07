import { randomUUID } from 'node:crypto';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
import { VerifyPoint } from '@proanima/arkvory-application';
import {
  FileVault,
  addRecoveryKit,
  initializeEncryptedVault,
  listSlots,
  parseKey,
  removeKeySlot,
  requireSeparateTrees,
  rotateAgentKey,
} from '@proanima/arkvory-infrastructure';
import type { BackupCommand } from './arguments.js';
import type { CliContext } from './context.js';
import { openVault, vaultKeys } from './source.js';

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
  const created = { vaultId: randomUUID(), createdAt: new Date().toISOString() };
  const encryption = command.encryption;
  // An encrypted vault comes with the agent key and the recovery kit (ADR 0070); both
  // are opened again before success is reported, and nothing is left behind if one fails.
  const identity =
    encryption.mode === 'none'
      ? await FileVault.initialize(command.vault, created)
      : await initializeEncryptedVault({
          vault: command.vault,
          ...created,
          agentKeyFile: encryption.agentKeyFile,
          kitFile: encryption.kitFile,
          ...(storage ? { storageRoot: storage } : {}),
        });
  context.logger.write({
    level: 'info',
    component: 'backup',
    code: 'backup.vault.initialized',
    vaultId: identity.vaultId,
    encrypted: identity.encryption !== 'none',
  });
  return 0;
}

/** Administration of the key slots; keys are written to files and never to a log line. */
export async function runVaultKey(
  command: Extract<BackupCommand, { kind: 'vault-key' }>,
  context: CliContext,
): Promise<number> {
  const { operation } = command;
  const storage = context.env['ARKVORY_DATA_DIR'];
  if (operation.action === 'list') {
    const vault = await FileVault.open(command.vault);
    const identity = await vault.describe();
    if (identity.encryption === 'none')
      throw new BackupFailure('invalid_argument', 'The vault is not encrypted');
    for (const slot of await listSlots(vault.root))
      context.logger.write({
        level: 'info',
        component: 'backup',
        code: 'backup.vault.key',
        vaultId: identity.vaultId,
        slotId: slot.slotId,
        keyKind: slot.kind,
        createdAt: slot.createdAt,
      });
    return 0;
  }
  const keys = vaultKeys(command.keyFile, context.env);
  const vault = await openVault(command.vault, undefined, keys);
  const { vaultId, encryption } = await vault.identity();
  if (encryption === 'none')
    throw new BackupFailure('invalid_argument', 'The vault is not encrypted');
  let slotId: string | undefined;
  let keyKind: string | undefined;
  switch (operation.action) {
    case 'verify':
      // The vault opened with this key: say which kind of key it is, not the key.
      keyKind = parseKey((await keys?.read()) ?? '').kind;
      break;
    case 'add-recovery':
      slotId = await addRecoveryKit(vault, operation.kitFile, storage);
      keyKind = 'recovery';
      break;
    case 'rotate-agent': {
      const rotated = await rotateAgentKey(vault, operation.agentKeyFile, storage);
      slotId = rotated.added;
      keyKind = 'agent';
      // The previous agent slots stay until the new key file is installed for the agent; the
      // operator then removes them with `vault key remove --slot`.
      for (const previous of rotated.previous)
        context.logger.write({
          level: 'warning',
          component: 'backup',
          code: 'backup.vault.key.previous',
          vaultId,
          slotId: previous,
        });
      break;
    }
    case 'remove':
      await removeKeySlot(vault, operation.slotId);
      slotId = operation.slotId;
      break;
  }
  context.logger.write({
    level: 'info',
    component: 'backup',
    code: `backup.vault.key.${operation.action}`,
    vaultId,
    ...(slotId === undefined ? {} : { slotId }),
    ...(keyKind === undefined ? {} : { keyKind }),
  });
  return 0;
}

export async function runList(
  command: Extract<BackupCommand, { kind: 'list' }>,
  context: CliContext,
): Promise<number> {
  const vault = await openVault(command.vault, undefined, vaultKeys(command.keyFile, context.env));
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
  const vault = await openVault(command.vault, undefined, vaultKeys(command.keyFile, context.env));
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

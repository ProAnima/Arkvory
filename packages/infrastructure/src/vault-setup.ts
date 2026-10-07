import { open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { VaultIdentity } from '@proanima/arkvory-domain';
import { FileVault } from './file-vault.js';
import { hasCode } from './fs-durability.js';
import {
  addSlot,
  keyFileSource,
  listSlots,
  newKey,
  removeSlot,
  withKeyAdministration,
} from './vault-keys.js';
import type { KeyKind } from './vault-keys.js';
import { requireSeparateTrees } from './vault-paths.js';

/*
 * Creation and administration of the keys of an encrypted vault (ADR 0070). Every key that is
 * written is opened again, as the service and as the operator will use it, before the call
 * reports success: a recovery kit that does not open the vault is found now, not in a disaster.
 */

/** The text of a recovery kit: what the operator keeps outside the server. */
export function recoveryKitText(identity: VaultIdentity, key: string): string {
  return [
    'ARKVORY VAULT RECOVERY KIT',
    '==========================',
    '',
    `Vault ID:      ${identity.vaultId}`,
    `Vault created: ${identity.createdAt}`,
    `Format:        ${identity.format} ${String(identity.version)}, ${identity.encryption}`,
    '',
    `Recovery key:  ${key}`,
    '',
    'Keep this file outside the Arkvory server and outside the vault, for example in a password',
    'manager or on a printed page in a safe. Without this key or the agent key the',
    'backups cannot be read, and nobody can restore them for you. Anyone who has this key and a',
    'copy of the vault can read every backup in it.',
    '',
    'To restore on a new server, give this file to the restore command:',
    '  arkvory-backup restore --vault <vault directory> --point <id> --storage <directory> --key-file <this file>',
    '',
  ].join('\n');
}

/**
 * A new file for a secret, owner-only; an existing file is never replaced or removed. A file
 * this call created and could not finish is removed again, so a retry finds the path free.
 */
async function writeNewSecret(path: string, text: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if (hasCode(error, 'EEXIST'))
      throw new BackupFailure('invalid_argument', 'The key file already exists: choose a new path');
    if (hasCode(error, 'ENOENT'))
      throw new BackupFailure('invalid_argument', 'The directory of the key file does not exist');
    throw error;
  }
  try {
    await handle.writeFile(text);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removeIfPresent(path);
    throw error;
  }
  await handle.close();
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** A key file must not lie in the vault or in the storage root: they are lost or copied together. */
async function separate(
  file: { readonly label: string; readonly path: string },
  vault: string,
  storageRoot: string | undefined,
): Promise<void> {
  await requireSeparateTrees({ label: 'vault', path: vault }, file);
  if (storageRoot !== undefined)
    await requireSeparateTrees({ label: 'storage root', path: storageRoot }, file);
}

/** Empties a directory that this call has just filled; the directory itself stays. */
async function empty(directory: string): Promise<void> {
  for (const name of await readdir(directory))
    await rm(join(directory, name), { recursive: true, force: true });
}

async function opens(vaultDirectory: string, keyFile: string): Promise<void> {
  const vault = await FileVault.open(vaultDirectory, undefined, keyFileSource(keyFile));
  await vault.identity();
}

/**
 * Creates an encrypted vault together with the agent key file and the recovery kit,
 * and opens the vault with each of them. If anything fails the new vault and both files are
 * removed again: the keys exist nowhere else.
 */
export async function initializeEncryptedVault(options: {
  readonly vault: string;
  readonly vaultId: string;
  readonly createdAt: string;
  readonly agentKeyFile: string;
  readonly kitFile: string;
  readonly storageRoot?: string;
}): Promise<VaultIdentity> {
  const { vault, agentKeyFile, kitFile } = options;
  if (agentKeyFile === kitFile)
    throw new BackupFailure('invalid_argument', 'The key file and the kit are two files');
  await separate({ label: 'recovery kit', path: kitFile }, vault, options.storageRoot);
  await separate({ label: 'key file', path: agentKeyFile }, vault, options.storageRoot);
  const created = await FileVault.initializeEncrypted(vault, options);
  const written: string[] = [];
  try {
    await writeNewSecret(agentKeyFile, `${created.agentKey}\n`);
    written.push(agentKeyFile);
    await writeNewSecret(kitFile, recoveryKitText(created.identity, created.recoveryKey));
    written.push(kitFile);
    await opens(vault, agentKeyFile);
    await opens(vault, kitFile);
    return created.identity;
  } catch (error) {
    for (const file of written) await removeIfPresent(file);
    await empty(vault).catch(() => undefined);
    throw error;
  }
}

/**
 * Writes a new secret file for a new slot key, then the slot, then opens the vault with the file.
 * The file comes first: a crash in between leaves a file whose key opens nothing, never a slot
 * whose key nobody holds (an orphan recovery slot would satisfy the "last recovery slot" rule).
 */
async function addSlotWithFile(
  vault: FileVault,
  kind: KeyKind,
  file: string,
  text: (identity: VaultIdentity, key: string) => string,
): Promise<string> {
  const identity = await vault.identity();
  const master = await vault.masterKey();
  const key = newKey(kind);
  await writeNewSecret(file, text(identity, key.text));
  let slotId: string | undefined;
  try {
    const added = await addSlot(
      vault.root,
      identity.vaultId,
      master,
      kind,
      new Date().toISOString(),
      key,
    );
    slotId = added.slot.slotId;
    await opens(vault.root, file);
    return slotId;
  } catch (error) {
    // Only the file this call wrote is removed: an existing file was refused by writeNewSecret.
    await removeIfPresent(file);
    if (slotId !== undefined) await removeSlot(vault.root, slotId).catch(() => undefined);
    throw error;
  }
}

/** Adds a recovery slot and writes its kit; the vault must be open with a key that unlocks it. */
async function addRecoveryKitLocked(
  vault: FileVault,
  kitFile: string,
  storageRoot?: string,
): Promise<string> {
  await separate({ label: 'recovery kit', path: kitFile }, vault.root, storageRoot);
  return addSlotWithFile(vault, 'recovery', kitFile, recoveryKitText);
}

/**
 * Gives the agent a new key: a new agent slot and key file, opened with. The previous agent slots
 * stay, because the running agent still reads its old key file and would stop within a minute;
 * the operator installs the new file (arkvory configure --vault-key-file) and then removes the
 * returned previous slots with `vault key remove`.
 */
async function rotateAgentKeyLocked(
  vault: FileVault,
  agentKeyFile: string,
  storageRoot?: string,
): Promise<{ readonly added: string; readonly previous: readonly string[] }> {
  await separate({ label: 'key file', path: agentKeyFile }, vault.root, storageRoot);
  const before = await listSlots(vault.root);
  const added = await addSlotWithFile(vault, 'agent', agentKeyFile, (_, key) => `${key}\n`);
  const previous = before.filter((slot) => slot.kind === 'agent').map((slot) => slot.slotId);
  return { added, previous };
}

/** Adds a recovery slot and its kit under the key administration lock. */
export function addRecoveryKit(
  vault: FileVault,
  kitFile: string,
  storageRoot?: string,
): Promise<string> {
  return withKeyAdministration(vault.root, () => addRecoveryKitLocked(vault, kitFile, storageRoot));
}

/** Replaces the agent access under the key administration lock. */
export function rotateAgentKey(
  vault: FileVault,
  agentKeyFile: string,
  storageRoot?: string,
): Promise<{ readonly added: string; readonly previous: readonly string[] }> {
  return withKeyAdministration(vault.root, () =>
    rotateAgentKeyLocked(vault, agentKeyFile, storageRoot),
  );
}

/** Revokes one slot under the key administration lock; the last slots are kept. */
export function removeKeySlot(vault: FileVault, slotId: string): Promise<void> {
  return withKeyAdministration(vault.root, () => removeSlot(vault.root, slotId));
}

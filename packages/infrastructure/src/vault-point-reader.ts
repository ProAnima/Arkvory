import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BackupFailure,
  parseBackupManifest,
  parseCommitRecord,
  parseVaultJson,
  requireId,
} from '@proanima/arkvory-domain';
import type { BackupManifest, VaultIdentity } from '@proanima/arkvory-domain';
import { hasCode } from './fs-durability.js';
import type { VaultCipher } from './vault-crypto.js';
import { manifestDigest } from './vault-staged-point.js';

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export function missing(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}

export async function readDocument(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > MAX_DOCUMENT_BYTES)
      throw new BackupFailure('invalid_manifest', 'Vault document is too large');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/**
 * Reads and checks one committed point: the commit record binds the content of the manifest,
 * which an encrypted vault decrypts first. Null when the point directory does not exist.
 */
export async function readPoint(
  root: string,
  pointId: string,
  identity: VaultIdentity,
  cipher: VaultCipher | null,
): Promise<BackupManifest | null> {
  const directory = join(root, 'points', requireId(pointId));
  if (!(await exists(directory))) return null;
  let commitText: Buffer, stored: Buffer;
  try {
    commitText = await readDocument(join(directory, 'COMMITTED'));
    stored = await readDocument(join(directory, 'manifest.json'));
  } catch (error) {
    if (missing(error)) throw new BackupFailure('invalid_manifest', 'Point is incomplete');
    throw error;
  }
  const commit = parseCommitRecord(parseVaultJson(commitText.toString('utf8')));
  let manifestText: Buffer;
  try {
    manifestText = cipher
      ? cipher.forFile('manifest', `${pointId}/manifest.json`).decryptBuffer(stored)
      : stored;
  } catch (error) {
    // A manifest that does not authenticate is a damaged point, like one that does not parse.
    throw new BackupFailure('invalid_manifest', 'Manifest failed authentication', { cause: error });
  }
  if (commit.pointId !== pointId || commit.manifestSha256 !== manifestDigest(manifestText))
    throw new BackupFailure('invalid_manifest', 'Commit record does not match the manifest');
  const manifest = parseBackupManifest(parseVaultJson(manifestText.toString('utf8')));
  if (manifest.pointId !== pointId || manifest.vaultId !== identity.vaultId)
    throw new BackupFailure('invalid_manifest', 'Manifest belongs to another point or vault');
  return manifest;
}

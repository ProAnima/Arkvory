import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, rm, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BackupFailure,
  ENCRYPTED_VAULT_FORMAT_VERSION,
  VAULT_ENCRYPTION,
  VAULT_FORMAT,
  VAULT_FORMAT_VERSION,
  idPattern,
  parseVaultIdentity,
  parseVaultJson,
  requireId,
} from '@proanima/arkvory-domain';
import type {
  BackupManifest,
  InventoryEntry,
  PointFile,
  VaultIdentity,
} from '@proanima/arkvory-domain';
import type {
  Cancellation,
  CaptureVault,
  FileDigest,
  MaintainedVault,
  StagedPoint,
  VaultListing,
} from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';
import { canonicalPath } from './vault-paths.js';
import { missing, publishPoint, readDocument, readPoint } from './vault-point-reader.js';
import { forgetPoint, pruneVault, sharedContentBytes, vaultListing } from './vault-maintenance.js';
import { VaultCipher, encryptedSize } from './vault-crypto.js';
import type { FileCipher, VaultFileKind } from './vault-crypto.js';
import { createKeys, listSlots, unlockWith } from './vault-keys.js';
import type { VaultKeySource } from './vault-keys.js';
import {
  VAULT_DIRECTORY_MODE,
  digestFile,
  hashFile,
  readExactly,
  readLines,
  writeDurably,
} from './vault-files.js';
import { StagedPointDirectory, pointFileCipher, pointFileParts } from './vault-staged-point.js';

/*
 * Layout (format 1, plain; format 2, encrypted, ADR 0070):
 *   vault.json                         identity; required before any read or write
 *   keys/<slot>.json                   encrypted vault only: the master key wrapped by a slot key
 *   blobs/<first two hex>/<content id> immutable content, shared by all points
 *   points/<point id>/                 committed point: manifest.json, inventory.ndjson,
 *                                      tables/<table>.ndjson and COMMITTED (written last)
 *   points/.staging/<point>.<n>.<rnd>/ attempt in progress; published by one directory rename
 * Directories are never created recursively below the root, so a missing mount fails instead
 * of silently writing into an empty local mount point.
 */
const MAX_POINTS = 10000;
const pointName = new RegExp(idPattern);
/** How long an unlocked vault trusts its key before the key file and the slot are checked again. */
const RECHECK_MS = 60_000;
const never: Cancellation = { throwIfAborted() {} };

export interface FileVaultOptions {
  /** Free space kept on the vault volume besides the content being written. */
  readonly reserveBytes: number;
  /** Longest accepted NDJSON line (one exported row). */
  readonly maxLine: number;
}
export const defaultFileVaultOptions: FileVaultOptions = {
  reserveBytes: 1024 ** 3,
  maxLine: 16 * 1024 * 1024,
};

async function* once(chunk: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield chunk;
}
/**
 * Built-in vault on a local disk or mounted NAS directory (ADR 0054). An encrypted vault
 * (ADR 0070) needs a key source: the key is read when the vault is first used and the master key
 * stays in memory only. Forget and prune (ADR 0056) run only under the exclusive vault lock.
 */
export class FileVault implements CaptureVault, MaintainedVault {
  private cipher: VaultCipher | null = null;
  private unlockedAt = 0;

  private constructor(
    readonly root: string,
    private readonly options: FileVaultOptions,
    private readonly keys: VaultKeySource | undefined,
  ) {}

  /** Opens without writing anything; identity() then proves the directory is a vault. */
  static async open(
    directory: string,
    options: FileVaultOptions = defaultFileVaultOptions,
    keys?: VaultKeySource,
  ): Promise<FileVault> {
    return new FileVault(await canonicalPath(directory), options, keys);
  }

  /** The directory of a new vault: created or empty, parent present, subfolders made. */
  private static async prepare(directory: string): Promise<string> {
    const root = resolve(directory);
    try {
      await mkdir(root, { mode: VAULT_DIRECTORY_MODE });
    } catch (error) {
      if (missing(error))
        throw new BackupFailure('vault_missing', 'Parent of the vault directory does not exist');
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    if ((await readdir(root)).length)
      throw new BackupFailure('target_not_empty', 'Vault directory must be empty');
    // Windows ignores POSIX modes; operators restrict the directory with ACLs (runbook).
    if (process.platform !== 'win32') await chmod(root, VAULT_DIRECTORY_MODE);
    for (const folder of [['blobs'], ['points'], ['points', '.staging']])
      await mkdir(join(root, ...folder), { mode: VAULT_DIRECTORY_MODE });
    return root;
  }

  private static async seal(
    root: string,
    document: Record<string, unknown>,
  ): Promise<VaultIdentity> {
    const parsed = parseVaultIdentity(document);
    await writeDurably(
      join(root, 'vault.json'),
      once(Buffer.from(JSON.stringify(document, null, 2) + '\n')),
      { cancellation: never },
    );
    await syncDirectory(root);
    return parsed;
  }

  /** Creates a plain vault in a new or empty directory whose parent already exists. */
  static async initialize(
    directory: string,
    identity: { readonly vaultId: string; readonly createdAt: string },
  ): Promise<VaultIdentity> {
    const root = await FileVault.prepare(directory);
    return FileVault.seal(root, {
      format: VAULT_FORMAT,
      version: VAULT_FORMAT_VERSION,
      vaultId: identity.vaultId,
      createdAt: identity.createdAt,
      encryption: 'none',
    });
  }

  /**
   * Creates an encrypted vault (ADR 0070) and returns its two keys, the only time they exist
   * outside a file the caller writes: one for the service, one for the recovery kit. vault.json
   * comes last, so a vault that failed halfway is still not a vault.
   */
  static async initializeEncrypted(
    directory: string,
    identity: { readonly vaultId: string; readonly createdAt: string },
  ): Promise<{
    readonly identity: VaultIdentity;
    readonly agentKey: string;
    readonly recoveryKey: string;
  }> {
    const root = await FileVault.prepare(directory);
    try {
      const keys = await createKeys(root, identity.vaultId, identity.createdAt);
      const sealed = await FileVault.seal(root, {
        format: VAULT_FORMAT,
        version: ENCRYPTED_VAULT_FORMAT_VERSION,
        vaultId: identity.vaultId,
        createdAt: identity.createdAt,
        encryption: VAULT_ENCRYPTION,
      });
      return { identity: sealed, agentKey: keys.agentKey, recoveryKey: keys.recoveryKey };
    } catch (error) {
      // The directory was empty before this call, so a retry needs it empty again.
      for (const name of await readdir(root).catch(() => []))
        await rm(join(root, name), { recursive: true, force: true });
      throw error;
    }
  }

  /** The identity as vault.json states it; no key is needed and none is read. */
  async describe(): Promise<VaultIdentity> {
    let text: Buffer;
    try {
      text = await readDocument(join(this.root, 'vault.json'));
    } catch (error) {
      if (missing(error))
        throw new BackupFailure(
          'vault_missing',
          'Directory has no vault.json: initialize the vault or check that the volume is mounted',
        );
      throw error;
    }
    return parseVaultIdentity(parseVaultJson(text.toString('utf8')));
  }

  /**
   * Proves the directory is a vault and, for an encrypted one, unlocks it: a missing key is
   * `vault_key_missing`, a key that opens no slot `vault_key_invalid`.
   */
  async identity(): Promise<VaultIdentity> {
    const identity = await this.describe();
    if (identity.encryption === 'none') {
      // vault.json is not authenticated: a plain vault that still holds key slots, or that is
      // opened with a key, was an encrypted one whose identity was rewritten (a downgrade).
      if (this.keys !== undefined || (await listSlots(this.root)).length > 0)
        throw new BackupFailure(
          'integrity_mismatch',
          'The vault is not encrypted but has key slots or was given a key: vault.json was changed',
        );
      this.cipher = null;
      return identity;
    }
    // A key that was revoked or whose file was removed stops working within a minute, not at the
    // next restart of a long-running agent.
    const fresh =
      this.cipher?.vaultId === identity.vaultId && Date.now() - this.unlockedAt < RECHECK_MS;
    if (!fresh) {
      if (this.keys === undefined)
        throw new BackupFailure('vault_key_missing', 'The vault is encrypted and no key is given');
      try {
        const master = await unlockWith(this.root, identity.vaultId, await this.keys.read());
        if (this.cipher?.vaultId !== identity.vaultId)
          this.cipher = new VaultCipher(master, identity.vaultId);
        this.unlockedAt = Date.now();
      } catch (error) {
        this.cipher = null;
        throw error;
      }
    }
    return identity;
  }

  /** The master key of an unlocked vault, for key administration only (new slots wrap it). */
  async masterKey(): Promise<Buffer> {
    await this.identity();
    if (this.cipher === null)
      throw new BackupFailure('invalid_argument', 'The vault is not encrypted');
    return this.cipher.slotMaster();
  }

  private async fileCipher(kind: VaultFileKind, name: string): Promise<FileCipher | undefined> {
    await this.identity();
    return this.cipher?.forFile(kind, name);
  }

  /** Cipher of the temporary files of a prune run; undefined for a plain vault. */
  scratchCipher(name: string): Promise<FileCipher | undefined> {
    return this.fileCipher('scratch', `prune/${name}`);
  }

  async stage(pointId: string, attempt: number): Promise<StagedPoint> {
    await this.identity();
    const staging = join(this.root, 'points', '.staging');
    // Leftovers of earlier attempts of the same point are never visible and may be dropped.
    for (const name of await readdir(staging))
      if (name.startsWith(requireId(pointId) + '.'))
        await rm(join(staging, name), { recursive: true, force: true, maxRetries: 3 });
    const directory = join(staging, `${pointId}.${String(attempt)}.${randomUUID()}`);
    await mkdir(directory, { mode: VAULT_DIRECTORY_MODE });
    await mkdir(join(directory, 'tables'), { mode: VAULT_DIRECTORY_MODE });
    return new StagedPointDirectory({
      directory,
      pointId,
      maxLine: this.options.maxLine,
      cipher: this.cipher,
      publish: (staged, id) => this.publish(staged, id),
    });
  }

  private blobPath(id: string): string {
    return join(this.root, 'blobs', requireId(id).slice(0, 2), id);
  }

  async hasBlob(entry: InventoryEntry): Promise<boolean> {
    await this.identity();
    const size = this.cipher ? encryptedSize(entry.size) : entry.size;
    try {
      const info = await stat(this.blobPath(entry.id));
      return info.isFile() && info.size === size;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  async putBlob(
    entry: InventoryEntry,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    // Checked before every object: a volume that disappears mid-capture fails the write.
    await this.identity();
    const cipher = this.cipher?.forFile('blob', entry.id);
    const needed = BigInt(cipher ? encryptedSize(entry.size) : entry.size);
    const volume = await statfs(this.root, { bigint: true });
    if (volume.bavail * volume.bsize < needed + BigInt(this.options.reserveBytes))
      throw new BackupFailure('vault_full', 'Not enough free space on the vault volume');
    const shard = join(this.root, 'blobs', entry.id.slice(0, 2));
    try {
      await mkdir(shard, { mode: VAULT_DIRECTORY_MODE });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    await writeDurably(this.blobPath(entry.id), source, {
      cancellation,
      expected: entry,
      ...(cipher ? { cipher } : {}),
    });
  }

  async pointIds(): Promise<readonly string[]> {
    await this.identity();
    const names = await readdir(join(this.root, 'points'));
    return names
      .filter((name) => pointName.test(name))
      .sort()
      .slice(0, MAX_POINTS);
  }

  async point(pointId: string): Promise<BackupManifest | null> {
    const identity = await this.identity();
    return readPoint(this.root, pointId, identity, this.cipher);
  }

  pointPath(pointId: string, name: string): string {
    return join(this.root, 'points', requireId(pointId), ...pointFileParts(name));
  }

  async digest(
    pointId: string,
    name: string,
    cancellation: Cancellation,
  ): Promise<FileDigest | null> {
    await this.identity();
    return digestFile(
      this.pointPath(pointId, name),
      cancellation,
      pointFileCipher(this.cipher, pointId, name),
    );
  }

  async *lines(
    pointId: string,
    name: string,
    expected: PointFile,
    cancellation: Cancellation,
  ): AsyncIterable<string> {
    await this.identity();
    const cipher = pointFileCipher(this.cipher, pointId, name);
    yield* readLines(this.pointPath(pointId, name), {
      maxLine: this.options.maxLine,
      cancellation,
      expected,
      ...(cipher ? { cipher } : {}),
    });
  }

  async blobDigest(entry: InventoryEntry, cancellation: Cancellation): Promise<string | null> {
    await this.identity();
    return hashFile(
      this.blobPath(entry.id),
      entry.size,
      cancellation,
      this.cipher?.forFile('blob', entry.id),
    );
  }

  async *readBlob(entry: InventoryEntry): AsyncIterable<Uint8Array> {
    await this.identity();
    yield* readExactly(this.blobPath(entry.id), entry.size, this.cipher?.forFile('blob', entry.id));
  }

  listing(): Promise<VaultListing> {
    return vaultListing(this);
  }

  sharedBytes(point: BackupManifest, previous: BackupManifest, cancellation: Cancellation) {
    return sharedContentBytes(this, point, previous, cancellation);
  }

  forget(pointId: string): Promise<void> {
    return forgetPoint(this, pointId);
  }

  prune(remaining: readonly BackupManifest[], cancellation: Cancellation) {
    return pruneVault(this, remaining, cancellation);
  }

  /** Free and total bytes of the vault volume (statfs), for the agent heartbeat. */
  async volume(): Promise<{ readonly freeBytes: bigint; readonly totalBytes: bigint }> {
    await this.identity();
    const volume = await statfs(this.root, { bigint: true });
    return { freeBytes: volume.bavail * volume.bsize, totalBytes: volume.blocks * volume.bsize };
  }

  /**
   * Creates and removes one empty file in the staging area, so a read-only remount or a lost
   * write permission shows in the heartbeat before the next copy fails. A probe left by a crash
   * is removed by prune with the other attempt leftovers; prune may also remove a live one.
   */
  async writeProbe(): Promise<void> {
    await this.identity();
    const probe = join(this.root, 'points', '.staging', `probe.${randomUUID()}`);
    await (await open(probe, 'wx', 0o600)).close();
    await rm(probe, { force: true });
  }

  /** One directory rename publishes the point; a second publisher of the id sees `exists`. */
  async publish(staged: string, pointId: string): Promise<'committed' | 'exists'> {
    await this.identity();
    return publishPoint(this.root, staged, pointId);
  }
}

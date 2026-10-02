import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BackupFailure,
  INVENTORY_FILE,
  VAULT_FORMAT,
  VAULT_FORMAT_VERSION,
  idPattern,
  manifestDocument,
  parseBackupManifest,
  parseCommitRecord,
  parseVaultIdentity,
  parseVaultJson,
  requireId,
  tableFileName,
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
  ReadableVault,
  StagedPoint,
} from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';
import { canonicalPath } from './vault-paths.js';
import {
  VAULT_DIRECTORY_MODE,
  digestFile,
  encodeLines,
  hashFile,
  readExactly,
  readLines,
  writeDurably,
} from './vault-files.js';

/*
 * Layout (format 1):
 *   vault.json                         identity; required before any read or write
 *   blobs/<first two hex>/<content id> immutable content, shared by all points
 *   points/<point id>/                 committed point: manifest.json, inventory.ndjson,
 *                                      tables/<table>.ndjson and COMMITTED (written last)
 *   points/.staging/<point>.<n>.<rnd>/ attempt in progress; published by one directory rename
 * Directories are never created recursively below the root, so a missing mount fails instead
 * of silently writing into an empty local mount point.
 */
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_POINTS = 10000;
const pointName = new RegExp(idPattern);
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

function missing(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}
async function* once(chunk: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield chunk;
}
async function readDocument(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > MAX_DOCUMENT_BYTES)
      throw new BackupFailure('invalid_manifest', 'Vault document is too large');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
/** The only point file names a caller may address; anything else is refused before access. */
function pointFileParts(name: string): readonly string[] {
  if (name === INVENTORY_FILE) return [INVENTORY_FILE];
  const table = /^tables\/(arkvory_[a-z0-9_]{1,55})\.ndjson$/.exec(name)?.[1];
  if (table !== undefined && tableFileName(table) === name) return ['tables', `${table}.ndjson`];
  throw new BackupFailure('unsafe_path', 'Unexpected point file name');
}

/** Built-in vault on a local disk or mounted NAS directory (ADR 0054); no encryption in B1. */
export class FileVault implements CaptureVault, ReadableVault {
  private constructor(
    readonly root: string,
    private readonly options: FileVaultOptions,
  ) {}

  /** Opens without writing anything; identity() then proves the directory is a vault. */
  static async open(
    directory: string,
    options: FileVaultOptions = defaultFileVaultOptions,
  ): Promise<FileVault> {
    return new FileVault(await canonicalPath(directory), options);
  }

  /** Creates a vault in a new or empty directory whose parent already exists. */
  static async initialize(
    directory: string,
    identity: { readonly vaultId: string; readonly createdAt: string },
  ): Promise<VaultIdentity> {
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
    const document = {
      format: VAULT_FORMAT,
      version: VAULT_FORMAT_VERSION,
      vaultId: identity.vaultId,
      createdAt: identity.createdAt,
      encryption: 'none',
    };
    const parsed = parseVaultIdentity(document);
    await writeDurably(
      join(root, 'vault.json'),
      once(Buffer.from(JSON.stringify(document, null, 2) + '\n')),
      { cancellation: never },
    );
    await syncDirectory(root);
    return parsed;
  }

  async identity(): Promise<VaultIdentity> {
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
    return new StagedPointDirectory(this, directory, pointId, this.options.maxLine);
  }

  private blobPath(id: string): string {
    return join(this.root, 'blobs', requireId(id).slice(0, 2), id);
  }

  async hasBlob(entry: InventoryEntry): Promise<boolean> {
    try {
      const info = await stat(this.blobPath(entry.id));
      return info.isFile() && info.size === entry.size;
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
    const volume = await statfs(this.root, { bigint: true });
    if (volume.bavail * volume.bsize < BigInt(entry.size) + BigInt(this.options.reserveBytes))
      throw new BackupFailure('vault_full', 'Not enough free space on the vault volume');
    const shard = join(this.root, 'blobs', entry.id.slice(0, 2));
    try {
      await mkdir(shard, { mode: VAULT_DIRECTORY_MODE });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    await writeDurably(this.blobPath(entry.id), source, { cancellation, expected: entry });
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
    const directory = join(this.root, 'points', requireId(pointId));
    if (!(await exists(directory))) return null;
    let commitText: Buffer, manifestText: Buffer;
    try {
      commitText = await readDocument(join(directory, 'COMMITTED'));
      manifestText = await readDocument(join(directory, 'manifest.json'));
    } catch (error) {
      if (missing(error)) throw new BackupFailure('invalid_manifest', 'Point is incomplete');
      throw error;
    }
    const commit = parseCommitRecord(parseVaultJson(commitText.toString('utf8')));
    const digest = createHash('sha256').update(manifestText).digest('hex');
    if (commit.pointId !== pointId || commit.manifestSha256 !== digest)
      throw new BackupFailure('invalid_manifest', 'Commit record does not match the manifest');
    const manifest = parseBackupManifest(parseVaultJson(manifestText.toString('utf8')));
    if (manifest.pointId !== pointId || manifest.vaultId !== (await this.identity()).vaultId)
      throw new BackupFailure('invalid_manifest', 'Manifest belongs to another point or vault');
    return manifest;
  }

  pointPath(pointId: string, name: string): string {
    return join(this.root, 'points', requireId(pointId), ...pointFileParts(name));
  }

  async digest(
    pointId: string,
    name: string,
    cancellation: Cancellation,
  ): Promise<FileDigest | null> {
    return digestFile(this.pointPath(pointId, name), cancellation);
  }

  lines(
    pointId: string,
    name: string,
    expected: PointFile,
    cancellation: Cancellation,
  ): AsyncIterable<string> {
    return readLines(this.pointPath(pointId, name), {
      maxLine: this.options.maxLine,
      cancellation,
      expected,
    });
  }

  blobDigest(entry: InventoryEntry, cancellation: Cancellation): Promise<string | null> {
    return hashFile(this.blobPath(entry.id), entry.size, cancellation);
  }

  readBlob(entry: InventoryEntry): AsyncIterable<Uint8Array> {
    return readExactly(this.blobPath(entry.id), entry.size);
  }

  /** One directory rename publishes the point; a second publisher of the id sees `exists`. */
  async publish(staged: string, pointId: string): Promise<'committed' | 'exists'> {
    await this.identity();
    const target = join(this.root, 'points', requireId(pointId));
    for (let attempt = 0; ; attempt++) {
      if (await exists(target)) return 'exists';
      try {
        await rename(staged, target);
        break;
      } catch (error) {
        if (await exists(target)) return 'exists';
        // Windows may refuse a directory rename while a scanner briefly holds a handle.
        const transient = ['EPERM', 'EBUSY', 'EACCES'].some((code) => hasCode(error, code));
        if (!transient || attempt >= 4) throw error;
        await delay(50 * 2 ** attempt);
      }
    }
    await syncDirectory(join(this.root, 'points'));
    return 'committed';
  }
}

class StagedPointDirectory implements StagedPoint {
  private published = false;
  constructor(
    private readonly vault: FileVault,
    private readonly directory: string,
    private readonly pointId: string,
    private readonly maxLine: number,
  ) {}

  async write(name: string, lines: AsyncIterable<string>, cancellation: Cancellation) {
    return writeDurably(join(this.directory, ...pointFileParts(name)), encodeLines(lines), {
      cancellation,
      countLines: true,
    });
  }

  lines(name: string, cancellation: Cancellation): AsyncIterable<string> {
    return readLines(join(this.directory, ...pointFileParts(name)), {
      maxLine: this.maxLine,
      cancellation,
    });
  }

  async commit(manifest: BackupManifest): Promise<'committed' | 'exists'> {
    if (manifest.pointId !== this.pointId) throw new BackupFailure('unexpected', 'Wrong point');
    const text = Buffer.from(JSON.stringify(manifestDocument(manifest), null, 2) + '\n');
    const written = await writeDurably(join(this.directory, 'manifest.json'), once(text), {
      cancellation: never,
    });
    // COMMITTED binds the directory to this exact manifest and is written last.
    const record = { pointId: this.pointId, manifestSha256: written.sha256 };
    await writeDurably(
      join(this.directory, 'COMMITTED'),
      once(Buffer.from(JSON.stringify(record) + '\n')),
      { cancellation: never },
    );
    await syncDirectory(this.directory);
    const outcome = await this.vault.publish(this.directory, this.pointId);
    this.published = outcome === 'committed';
    return outcome;
  }

  async discard(): Promise<void> {
    if (this.published) return;
    await rm(this.directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

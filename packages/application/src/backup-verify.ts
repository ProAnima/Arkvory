import {
  BackupFailure,
  INVENTORY_FILE,
  parseInventoryEntry,
  parseVaultJson,
  tableFileName,
} from '@proanima/arkvory-domain';
import type { BackupManifest, InventoryEntry } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type { ReadableVault } from './backup-ports.js';

export type VerifyProblemCode =
  | 'manifest_invalid'
  | 'file_missing'
  | 'file_mismatch'
  | 'row_count_mismatch'
  | 'inventory_invalid'
  | 'blob_missing'
  | 'blob_mismatch';
export interface VerifyProblem {
  readonly code: VerifyProblemCode;
  /** A point file name or a content id; never an absolute path. */
  readonly subject: string;
}
export interface PointVerification {
  readonly pointId: string;
  readonly deep: boolean;
  readonly ok: boolean;
  readonly files: number;
  readonly blobs: number;
  readonly problems: readonly VerifyProblem[];
  /** More problems existed than the bounded report keeps. */
  readonly truncated: boolean;
}
const MAX_PROBLEMS = 100;

class Problems {
  readonly items: VerifyProblem[] = [];
  truncated = false;
  add(code: VerifyProblemCode, subject: string): void {
    if (this.items.length < MAX_PROBLEMS) this.items.push({ code, subject });
    else this.truncated = true;
  }
}

/**
 * A file of an encrypted vault that does not authenticate (changed, cut, swapped) fails its read
 * with 'integrity_mismatch'; a plain vault reports the same damage as a digest that differs.
 * Both are a problem of the point, not a reason to stop the verification.
 */
function isDamage(error: unknown): boolean {
  return error instanceof BackupFailure && error.code === 'integrity_mismatch';
}

function invalidPoint(pointId: string, deep: boolean): PointVerification {
  return {
    pointId,
    deep,
    ok: false,
    files: 0,
    blobs: 0,
    problems: [{ code: 'manifest_invalid', subject: 'manifest.json' }],
    truncated: false,
  };
}

/**
 * Structural verification compares every point file with its manifest digest and checks that
 * each inventory blob exists with its size; deep verification also hashes every blob. A point
 * that fails is reported, never repaired or removed.
 */
export interface VerifyOptions {
  /** Called for stored content whose bytes do not have the SHA-256 of its entry (deep). */
  readonly damagedBlob?: (entry: InventoryEntry) => void;
  /** Inventory entries checked so far and their content bytes; called after each entry. */
  readonly progress?: (done: { readonly blobs: number; readonly bytes: bigint }) => void;
}

export class VerifyPoint {
  constructor(
    private readonly vault: ReadableVault,
    private readonly options: VerifyOptions = {},
  ) {}

  async run(
    request: { readonly pointId?: string; readonly deep: boolean },
    cancellation: Cancellation,
  ): Promise<readonly PointVerification[]> {
    if (request.pointId !== undefined)
      return [await this.verify(await this.require(request.pointId), request.deep, cancellation)];
    const results: PointVerification[] = [];
    for (const pointId of await this.vault.pointIds()) {
      cancellation.throwIfAborted();
      let manifest: BackupManifest | null;
      try {
        manifest = await this.vault.point(pointId);
      } catch (error) {
        // A damaged point is reported with the others instead of hiding them.
        if (!(error instanceof BackupFailure) || error.code !== 'invalid_manifest') throw error;
        results.push(invalidPoint(pointId, request.deep));
        continue;
      }
      if (manifest) results.push(await this.verify(manifest, request.deep, cancellation));
    }
    return results;
  }

  async require(pointId: string): Promise<BackupManifest> {
    const manifest = await this.vault.point(pointId);
    if (!manifest) throw new BackupFailure('point_not_found', 'No committed point with this id');
    return manifest;
  }

  async verify(
    manifest: BackupManifest,
    deep: boolean,
    cancellation: Cancellation,
  ): Promise<PointVerification> {
    const problems = new Problems();
    for (const table of manifest.tables) {
      cancellation.throwIfAborted();
      const name = tableFileName(table.name);
      const digest = await this.digestOf(manifest.pointId, name, cancellation);
      if (digest === 'damaged') problems.add('file_mismatch', name);
      else if (!digest) problems.add('file_missing', name);
      else if (digest.sha256 !== table.sha256 || digest.bytes !== table.bytes)
        problems.add('file_mismatch', name);
      else if (digest.lines !== table.rows) problems.add('row_count_mismatch', name);
    }
    const blobs = await this.inventory(manifest, deep, problems, cancellation);
    return {
      pointId: manifest.pointId,
      deep,
      ok: problems.items.length === 0 && !problems.truncated,
      files: manifest.tables.length + 1,
      blobs,
      problems: problems.items,
      truncated: problems.truncated,
    };
  }

  private async digestOf(pointId: string, name: string, cancellation: Cancellation) {
    try {
      return await this.vault.digest(pointId, name, cancellation);
    } catch (error) {
      if (isDamage(error)) return 'damaged';
      throw error;
    }
  }

  private async blobHash(entry: InventoryEntry, cancellation: Cancellation) {
    try {
      return await this.vault.blobDigest(entry, cancellation);
    } catch (error) {
      if (isDamage(error)) return null;
      throw error;
    }
  }

  private async inventory(
    manifest: BackupManifest,
    deep: boolean,
    problems: Problems,
    cancellation: Cancellation,
  ): Promise<number> {
    const digest = await this.digestOf(manifest.pointId, INVENTORY_FILE, cancellation);
    if (digest === 'damaged') {
      problems.add('file_mismatch', INVENTORY_FILE);
      return 0;
    }
    if (!digest) {
      problems.add('file_missing', INVENTORY_FILE);
      return 0;
    }
    // Entries of an altered inventory cannot be trusted to name the content of the point.
    if (digest.sha256 !== manifest.inventory.sha256 || digest.bytes !== manifest.inventory.bytes) {
      problems.add('file_mismatch', INVENTORY_FILE);
      return 0;
    }
    let count = 0;
    let bytes = 0n;
    for await (const line of this.vault.lines(
      manifest.pointId,
      INVENTORY_FILE,
      manifest.inventory,
      cancellation,
    )) {
      cancellation.throwIfAborted();
      const entry = parseInventoryEntry(parseVaultJson(line));
      count++;
      bytes += BigInt(entry.size);
      if (!(await this.vault.hasBlob(entry))) problems.add('blob_missing', entry.id);
      else if (deep && (await this.blobHash(entry, cancellation)) !== entry.sha256) {
        problems.add('blob_mismatch', entry.id);
        this.options.damagedBlob?.(entry);
      }
      this.options.progress?.({ blobs: count, bytes });
    }
    if (count !== manifest.inventory.count || bytes.toString() !== manifest.inventory.contentBytes)
      problems.add('inventory_invalid', INVENTORY_FILE);
    return count;
  }
}

/**
 * Content ids are immutable, so a capture shares content an earlier point stored and checks
 * only its size. Content that rotted in the vault would therefore be inherited by every later
 * point while the source still holds good bytes. The caller holds the exclusive vault lock;
 * each blob is read once more, and only one that still differs is set aside.
 */
export async function setAsideDamaged(
  vault: Pick<ReadableVault, 'hasBlob' | 'blobDigest'> & {
    setAsideBlob(entry: InventoryEntry): Promise<void>;
  },
  entries: readonly InventoryEntry[],
  cancellation: Cancellation,
): Promise<number> {
  let moved = 0;
  for (const entry of entries) {
    cancellation.throwIfAborted();
    if (!(await vault.hasBlob(entry))) continue;
    const digest = await vault.blobDigest(entry, cancellation).catch((error: unknown) => {
      if (isDamage(error)) return null;
      throw error;
    });
    if (digest === entry.sha256) continue;
    await vault.setAsideBlob(entry);
    moved++;
  }
  return moved;
}

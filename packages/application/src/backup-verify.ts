import {
  BackupFailure,
  INVENTORY_FILE,
  parseInventoryEntry,
  parseVaultJson,
  tableFileName,
} from '@proanima/arkvory-domain';
import type { BackupManifest } from '@proanima/arkvory-domain';
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
export class VerifyPoint {
  constructor(private readonly vault: ReadableVault) {}

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
      const digest = await this.vault.digest(manifest.pointId, name, cancellation);
      if (!digest) problems.add('file_missing', name);
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

  private async inventory(
    manifest: BackupManifest,
    deep: boolean,
    problems: Problems,
    cancellation: Cancellation,
  ): Promise<number> {
    const digest = await this.vault.digest(manifest.pointId, INVENTORY_FILE, cancellation);
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
      else if (deep && (await this.vault.blobDigest(entry, cancellation)) !== entry.sha256)
        problems.add('blob_mismatch', entry.id);
    }
    if (count !== manifest.inventory.count || bytes.toString() !== manifest.inventory.contentBytes)
      problems.add('inventory_invalid', INVENTORY_FILE);
    return count;
  }
}

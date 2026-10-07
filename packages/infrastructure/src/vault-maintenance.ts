import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BackupFailure,
  INVENTORY_FILE,
  idPattern,
  parseInventoryEntry,
  parseVaultJson,
  requireId,
} from '@proanima/arkvory-domain';
import type { BackupManifest, InventoryEntry, VaultIdentity } from '@proanima/arkvory-domain';
import type { Cancellation, FileDigest, VaultListing } from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';
import type { FileCipher } from './vault-crypto.js';
import { VAULT_DIRECTORY_MODE, encodeLines, readLines, writeDurably } from './vault-files.js';

/** What maintenance needs from the file vault; implemented by FileVault. */
export interface MaintenanceVault {
  readonly root: string;
  identity(): Promise<VaultIdentity>;
  pointIds(): Promise<readonly string[]>;
  point(pointId: string): Promise<BackupManifest | null>;
  lines(
    pointId: string,
    name: string,
    expected: { readonly sha256: string; readonly bytes: string },
    cancellation: Cancellation,
  ): AsyncIterable<string>;
  /** Cipher of a temporary file of this run (ADR 0070); absent or undefined: written in plain. */
  scratchCipher?(name: string): Promise<FileCipher | undefined>;
}

/** Inventories merged at once; more points are first reduced into sorted union files. */
const MAX_FAN_IN = 64;
const idName = new RegExp(idPattern);
const shardName = /^[0-9a-f]{2}$/;
const temporaryName = /^\..+\.tmp$/;

function missing(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
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
/** Next value of an iterator, undefined at its end. */
async function nextOf<T>(iterator: AsyncIterator<T>): Promise<T | undefined> {
  const result = await iterator.next();
  return result.done ? undefined : result.value;
}
/** Ends an iterator early so its file handle closes. */
async function close<T>(iterator: AsyncIterator<T>): Promise<void> {
  await iterator.return?.();
}
function unsorted(): BackupFailure {
  return new BackupFailure('invalid_manifest', 'Inventory is not ordered by content id');
}

/** Committed, uncommitted and damaged point directories; foreign sources included. */
export async function vaultListing(vault: MaintenanceVault): Promise<VaultListing> {
  const identity = await vault.identity();
  const committed: BackupManifest[] = [];
  const uncommitted: string[] = [];
  const damaged: string[] = [];
  for (const pointId of await vault.pointIds()) {
    try {
      const manifest = await vault.point(pointId);
      if (manifest) committed.push(manifest);
    } catch (error) {
      if (!(error instanceof BackupFailure) || error.code !== 'invalid_manifest') throw error;
      const sealed = await exists(join(vault.root, 'points', pointId, 'COMMITTED'));
      (sealed ? damaged : uncommitted).push(pointId);
    }
  }
  return { identity, committed, uncommitted, damaged };
}

/** Inventory entries of a committed point, verified against its digest and order. */
async function* entries(
  vault: MaintenanceVault,
  manifest: BackupManifest,
  cancellation: Cancellation,
): AsyncIterable<InventoryEntry> {
  let previous = '';
  for await (const line of vault.lines(
    manifest.pointId,
    INVENTORY_FILE,
    manifest.inventory,
    cancellation,
  )) {
    const entry = parseInventoryEntry(parseVaultJson(line));
    // Capture writes inventories in id order (keyset pages); merges rely on it.
    if (entry.id <= previous) throw unsorted();
    previous = entry.id;
    yield entry;
  }
}

async function* ids(source: AsyncIterable<InventoryEntry>): AsyncIterable<string> {
  for await (const entry of source) yield entry.id;
}

/** Distinct ids of ascending sources in ascending order; a source out of order fails. */
async function* mergeAscending(sources: readonly AsyncIterable<string>[]): AsyncIterable<string> {
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  try {
    const heads = await Promise.all(iterators.map((iterator) => nextOf(iterator)));
    for (;;) {
      let low: string | undefined;
      for (const head of heads)
        if (head !== undefined && (low === undefined || head < low)) low = head;
      if (low === undefined) return;
      yield low;
      for (const [index, iterator] of iterators.entries()) {
        if (heads[index] !== low) continue;
        const next = await nextOf(iterator);
        if (next !== undefined && next <= low) throw unsorted();
        heads[index] = next;
      }
    }
  } finally {
    await Promise.all(iterators.map((iterator) => close(iterator)));
  }
}

async function* union(
  vault: MaintenanceVault,
  remaining: readonly BackupManifest[],
  scratch: string,
  cancellation: Cancellation,
): AsyncIterable<string> {
  let sources: (() => AsyncIterable<string>)[] = remaining.map(
    (manifest) => () => ids(entries(vault, manifest, cancellation)),
  );
  // Bounded open files: reduce groups into sorted union files until one merge suffices.
  for (let level = 0; sources.length > MAX_FAN_IN; level++) {
    const reduced: (() => AsyncIterable<string>)[] = [];
    for (let start = 0; start < sources.length; start += MAX_FAN_IN) {
      const group = sources.slice(start, start + MAX_FAN_IN).map((open) => open());
      const name = `union-${String(level)}-${String(start)}.ndjson`;
      const file = join(scratch, name);
      const cipher = await vault.scratchCipher?.(name);
      const written = await writeDurably(file, encodeLines(mergeAscending(group)), {
        cancellation,
        countLines: true,
        ...(cipher ? { cipher } : {}),
      });
      reduced.push(() => idsOf(file, written, cipher));
    }
    sources = reduced;
  }
  yield* mergeAscending(sources.map((open) => open()));
}

function idsOf(
  file: string,
  written: FileDigest,
  cipher: FileCipher | undefined,
): AsyncIterable<string> {
  return readLines(file, {
    maxLine: 64,
    cancellation: { throwIfAborted() {} },
    expected: { sha256: written.sha256, bytes: written.bytes },
    ...(cipher ? { cipher } : {}),
  });
}

/** Removes COMMITTED first, so the point is invisible before any of its files go. */
export async function forgetPoint(vault: MaintenanceVault, pointId: string): Promise<void> {
  await vault.identity();
  const directory = join(vault.root, 'points', requireId(pointId));
  try {
    await unlink(join(directory, 'COMMITTED'));
    await syncDirectory(directory);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  await syncDirectory(join(vault.root, 'points'));
}

/**
 * Prune under the exclusive vault lock: inventories of all remaining points are verified
 * (digest and order) before anything is deleted; then attempt leftovers go, and every blob no
 * remaining point lists, shard by shard against one sorted merge of the inventories.
 */
export async function pruneVault(
  vault: MaintenanceVault,
  remaining: readonly BackupManifest[],
  cancellation: Cancellation,
): Promise<{ readonly blobs: number; readonly bytes: bigint }> {
  await vault.identity();
  // A damaged inventory would hide content its point needs: check all before deleting any.
  for (const manifest of remaining) {
    let count = 0;
    for await (const entry of entries(vault, manifest, cancellation)) if (entry.size >= 0) count++;
    if (count !== manifest.inventory.count)
      throw new BackupFailure('invalid_manifest', 'Inventory differs from its manifest');
  }
  const staging = join(vault.root, 'points', '.staging');
  for (const name of await readdir(staging))
    await rm(join(staging, name), { recursive: true, force: true, maxRetries: 3 });
  const scratch = join(staging, `prune.${randomUUID()}`);
  await mkdir(scratch, { mode: VAULT_DIRECTORY_MODE });
  try {
    return await sweep(vault, union(vault, remaining, scratch, cancellation), cancellation);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function sweep(
  vault: MaintenanceVault,
  referenced: AsyncIterable<string>,
  cancellation: Cancellation,
): Promise<{ readonly blobs: number; readonly bytes: bigint }> {
  const iterator = referenced[Symbol.asyncIterator]();
  let head = await nextOf(iterator);
  let blobs = 0;
  let bytes = 0n;
  try {
    const shards = (await readdir(join(vault.root, 'blobs'))).filter((n) => shardName.test(n));
    for (const shard of shards.sort()) {
      // A volume that disappears mid-prune stops it instead of deleting into an empty mount.
      await vault.identity();
      const directory = join(vault.root, 'blobs', shard);
      for (const name of (await readdir(directory)).sort()) {
        cancellation.throwIfAborted();
        const path = join(directory, name);
        if (temporaryName.test(name)) {
          await rm(path, { force: true });
          continue;
        }
        if (!idName.test(name) || !name.startsWith(shard)) continue;
        while (head !== undefined && head < name) head = await nextOf(iterator);
        if (head === name) continue;
        const size = (await stat(path)).size;
        await unlink(path);
        blobs++;
        bytes += BigInt(size);
      }
      await syncDirectory(directory);
    }
  } finally {
    await close(iterator);
  }
  return { blobs, bytes };
}

/** Bytes of `point` whose ids `previous` also lists; both inventories are streamed once. */
export async function sharedContentBytes(
  vault: MaintenanceVault,
  point: BackupManifest,
  previous: BackupManifest,
  cancellation: Cancellation,
): Promise<bigint> {
  const left = entries(vault, point, cancellation)[Symbol.asyncIterator]();
  const right = ids(entries(vault, previous, cancellation))[Symbol.asyncIterator]();
  let shared = 0n;
  try {
    let other = await nextOf(right);
    for (let entry = await nextOf(left); entry; entry = await nextOf(left)) {
      while (other !== undefined && other < entry.id) other = await nextOf(right);
      if (other === entry.id) shared += BigInt(entry.size);
    }
  } finally {
    await Promise.all([close(left), close(right)]);
  }
  return shared;
}

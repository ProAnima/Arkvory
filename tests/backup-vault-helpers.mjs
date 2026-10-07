import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INVENTORY_FILE, inventoryLine } from '@proanima/arkvory-domain';
import { FileVault, keyFileSource } from '@proanima/arkvory-infrastructure';
import { writeFile } from 'node:fs/promises';
import { removeTestDirectory } from './helpers.mjs';

const never = { throwIfAborted() {} };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* lines(values) {
  for (const value of values) yield value;
}
async function* bytes(value) {
  yield value;
}

/** Storage id of the instance whose points the tests create by default. */
export const sourceId = randomUUID();
export const time = (minutes, day = 2) =>
  new Date(Date.UTC(2026, 9, day, 2, minutes)).toISOString();

/**
 * An initialized vault in a temp directory removed after the test. With `encrypted` the vault is
 * created encrypted and opened with its agent key from a file (ADR 0070); `keys` then holds both.
 */
export async function vaultIn(t, { encrypted = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-vault-maintenance-'));
  t.after(() => removeTestDirectory(directory));
  const path = join(directory, 'vault');
  const created = { vaultId: randomUUID(), createdAt: new Date().toISOString() };
  if (!encrypted) {
    const identity = await FileVault.initialize(path, created);
    return { vault: await FileVault.open(path), identity, path };
  }
  const made = await FileVault.initializeEncrypted(path, created);
  const keyFile = join(directory, 'agent.key');
  await writeFile(keyFile, made.agentKey + '\n');
  const vault = await FileVault.open(path, undefined, keyFileSource(keyFile));
  return {
    vault,
    identity: made.identity,
    path,
    keys: { agent: made.agentKey, recovery: made.recoveryKey, keyFile },
  };
}

/** A blob stored once in the vault, as a capture would copy it. */
export async function blob(vault, size = 32) {
  const content = Buffer.alloc(size, Math.floor(Math.random() * 255));
  const entry = { id: randomUUID(), size, sha256: sha(content) };
  await vault.putBlob(entry, bytes(content), never);
  return entry;
}

/** Commits a point listing `entries` (sorted by id, as capture writes them). */
export async function point(vault, identity, entries, takenAt, source = sourceId) {
  const pointId = randomUUID();
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
  const staged = await vault.stage(pointId, 1);
  const inventory = await staged.write(INVENTORY_FILE, lines(sorted.map(inventoryLine)), never);
  const users = await staged.write('tables/arkvory_users.ndjson', lines(['{"id":1}']), never);
  const manifest = {
    format: 'arkvory-backup-point',
    version: 1,
    pointId,
    jobId: randomUUID(),
    vaultId: identity.vaultId,
    sourceInstanceId: source,
    release: { version: '1.0.0', commit: null },
    schemaVersion: 26,
    postgresMajor: 18,
    snapshot: { takenAt, exportedId: '00000004-0000001B-1' },
    startedAt: takenAt,
    completedAt: takenAt,
    inventory: {
      count: sorted.length,
      contentBytes: String(sorted.reduce((sum, entry) => sum + entry.size, 0)),
      sha256: inventory.sha256,
      bytes: inventory.bytes,
    },
    tables: [{ name: 'arkvory_users', rows: 1, sha256: users.sha256, bytes: users.bytes }],
    excludedTables: [],
    pendingUploads: 0,
  };
  assert.equal(await staged.commit(manifest), 'committed');
  await staged.discard();
  return manifest;
}

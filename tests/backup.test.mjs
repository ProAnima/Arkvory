import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BackupFailure,
  INVENTORY_FILE,
  MAX_OBJECT_BYTES,
  backupFailureCodes,
  backupJobStates,
  backupTransitionAllowed,
  captureReuse,
  hasLiveAttempt,
  inventoryLine,
  manifestDocument,
  parseBackupManifest,
  parseInventoryEntry,
  parseVaultIdentity,
  restoreSchemaGate,
} from '@proanima/arkvory-domain';
import { FileVault, containsPath, requireSeparateTrees } from '@proanima/arkvory-infrastructure';
import { exitCodeFor, parseArguments } from '../apps/backup/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';

const never = { throwIfAborted() {} };
const digest = (text) => createHash('sha256').update(text).digest('hex');

test('capture states change only along the documented transitions', () => {
  const allowed = {
    running: ['committing', 'failed', 'interrupted'],
    committing: ['completed', 'interrupted'],
    failed: ['running'],
    interrupted: ['running'],
    completed: [],
  };
  for (const from of backupJobStates)
    for (const to of backupJobStates)
      assert.equal(backupTransitionAllowed(from, to), allowed[from].includes(to), `${from}→${to}`);
  assert.deepEqual(backupJobStates.filter(hasLiveAttempt), ['running', 'committing']);
});

test('a reused idempotency key returns, waits, fences or retries within the attempt bound', () => {
  const decide = (state, attempts, leaseExpired) =>
    captureReuse({ state, attempts, leaseExpired }, 5).action;
  assert.equal(decide('completed', 1, true), 'return_completed');
  assert.equal(decide('running', 1, false), 'busy');
  assert.equal(decide('committing', 5, false), 'busy');
  // Expiry alone never releases protection: the stale owner is fenced first, also when exhausted.
  assert.equal(decide('running', 5, true), 'fence');
  assert.equal(decide('committing', 1, true), 'fence');
  assert.equal(decide('failed', 4, true), 'retry');
  assert.equal(decide('interrupted', 5, true), 'exhausted');
});

test('restore accepts only schemas between the oldest normalization and this release', () => {
  assert.equal(restoreSchemaGate(25, 25, 25), 'compatible');
  assert.equal(restoreSchemaGate(26, 25, 25), 'too_new');
  assert.equal(restoreSchemaGate(24, 27, 25), 'too_old');
  assert.equal(restoreSchemaGate(26, 27, 25), 'compatible');
  assert.equal(restoreSchemaGate(25.5, 27, 25), 'too_new');
});

const id = () => randomUUID();
function manifest(overrides = {}) {
  return {
    format: 'arkvory-backup-point',
    version: 1,
    pointId: id(),
    jobId: id(),
    vaultId: id(),
    sourceInstanceId: id(),
    release: { version: '1.2.3', commit: 'a'.repeat(40) },
    schemaVersion: 25,
    postgresMajor: 18,
    snapshot: { takenAt: '2026-10-02T08:00:00.000Z', exportedId: '00000004-0000001B-1' },
    startedAt: '2026-10-02T08:00:00.000Z',
    completedAt: '2026-10-02T08:01:00.000Z',
    inventory: { count: 1, contentBytes: '68719476736', sha256: 'b'.repeat(64), bytes: '120' },
    tables: [{ name: 'arkvory_users', rows: 2, sha256: 'c'.repeat(64), bytes: '300' }],
    excludedTables: [{ name: 'arkvory_user_sessions', reason: 'ephemeral sessions' }],
    pendingUploads: 0,
    ...overrides,
  };
}

test('a manifest round-trips and every malformed or unsafe field is refused', () => {
  const valid = manifest();
  const document = manifestDocument(valid);
  assert.equal(document.tables[0].file, 'tables/arkvory_users.ndjson');
  assert.equal(document.inventory.file, INVENTORY_FILE);
  assert.deepEqual(parseBackupManifest(JSON.parse(JSON.stringify(document))), valid);
  const table = document.tables[0];
  const broken = [
    { ...document, version: 2 },
    { ...document, extra: true },
    { ...document, pointId: '../points' },
    { ...document, schemaVersion: -1 },
    { ...document, tables: [{ ...table, file: '../../outside.ndjson' }] },
    { ...document, tables: [{ ...table, file: '/etc/passwd' }] },
    { ...document, tables: [{ ...table, file: 'C:\\\\Windows\\\\x.ndjson' }] },
    { ...document, tables: [{ ...table, name: 'users; DROP TABLE x' }] },
    { ...document, tables: [table, table] },
    { ...document, tables: [] },
    { ...document, inventory: { ...document.inventory, file: '../inventory.ndjson' } },
    { ...document, inventory: { ...document.inventory, contentBytes: 12 } },
    { ...document, excludedTables: [{ name: 'arkvory_users', reason: 'both' }] },
    { ...document, snapshot: { ...document.snapshot, takenAt: 'yesterday' } },
    { ...document, release: { version: '1.2.3', commit: 'not-a-commit' } },
  ];
  for (const value of broken)
    assert.throws(() => parseBackupManifest(value), { code: 'invalid_manifest' });
});

test('inventory entries carry decimal sizes within the object limit', () => {
  const entry = { id: id(), size: 5, sha256: 'd'.repeat(64) };
  assert.deepEqual(parseInventoryEntry(JSON.parse(inventoryLine(entry))), entry);
  assert.match(inventoryLine(entry), /"size":"5"/);
  for (const size of ['-1', '01', '1.5', String(MAX_OBJECT_BYTES + 1), 5])
    assert.throws(() => parseInventoryEntry({ ...entry, size }), { code: 'invalid_manifest' });
  assert.throws(() => parseInventoryEntry({ ...entry, size: '5', sha256: 'D'.repeat(64) }));
  assert.throws(() =>
    parseVaultIdentity({
      format: 'arkvory-vault',
      version: 1,
      vaultId: id(),
      createdAt: '2026-10-02T08:00:00.000Z',
      encryption: 'aes',
    }),
  );
});

test('operator arguments are strict and every failure code has a documented exit code', () => {
  assert.deepEqual(parseArguments(['vault', 'init', 'D:/vault']), {
    kind: 'vault-init',
    vault: 'D:/vault',
  });
  const point = id();
  assert.deepEqual(
    parseArguments(['restore', '--vault', 'v', '--point', point, '--storage', 's', '--yes']),
    { kind: 'restore', vault: 'v', pointId: point, storage: 's', confirmed: true },
  );
  assert.deepEqual(parseArguments(['verify', '--vault', 'v', '--deep']), {
    kind: 'verify',
    vault: 'v',
    deep: true,
  });
  for (const argv of [
    ['capture'],
    ['capture', '--vault'],
    ['capture', '--vault', 'v', '--vault', 'w'],
    ['capture', '--vault', 'v', '--idempotency-key', 'has space'],
    ['restore', '--vault', 'v', '--point', 'not-an-id', '--storage', 's'],
    ['verify', '--vault', 'v', '--unknown'],
    ['vault', 'remove', 'v'],
    ['drop'],
  ])
    assert.throws(() => parseArguments(argv), { code: 'invalid_argument' });
  const exits = new Set(backupFailureCodes.map(exitCodeFor));
  assert.deepEqual([...exits].sort(), [1, 2, 3, 4, 5]);
  assert.equal(exitCodeFor('vault_missing'), 3);
  assert.equal(exitCodeFor('integrity_mismatch'), 4);
  assert.equal(exitCodeFor('busy'), 5);
});

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-vault-unit-'));
  t.after(() => removeTestDirectory(root));
  return root;
}
async function* chunks(...parts) {
  for (const part of parts) yield Buffer.from(part);
}
async function* lines(...values) {
  for (const value of values) yield value;
}

test('a vault exists only with vault.json and refuses overlapping storage trees', async (t) => {
  const root = await workspace(t);
  const empty = join(root, 'mount');
  await mkdir(empty);
  const unmounted = await FileVault.open(empty);
  await assert.rejects(unmounted.identity(), { code: 'vault_missing' });
  const entry = { id: id(), size: 1, sha256: digest('x') };
  await assert.rejects(unmounted.putBlob(entry, chunks('x'), never), { code: 'vault_missing' });
  await assert.rejects(unmounted.stage(id(), 1), { code: 'vault_missing' });
  assert.deepEqual(await readdir(empty), []);
  await writeFile(join(empty, 'other'), 'data');
  await assert.rejects(
    FileVault.initialize(empty, { vaultId: id(), createdAt: new Date().toISOString() }),
    { code: 'target_not_empty' },
  );
  await assert.rejects(
    FileVault.initialize(join(root, 'missing', 'vault'), {
      vaultId: id(),
      createdAt: new Date().toISOString(),
    }),
    { code: 'vault_missing' },
  );
  assert.equal(containsPath(join(root, 'a'), join(root, 'a', 'b')), true);
  assert.equal(containsPath(join(root, 'a'), join(root, 'ab')), false);
  for (const [first, second] of [
    [join(root, 'storage'), join(root, 'storage', 'vault')],
    [join(root, 'storage', 'vault'), join(root, 'storage')],
    [join(root, 'same'), join(root, 'same')],
  ])
    await assert.rejects(
      requireSeparateTrees({ label: 'vault', path: first }, { label: 'storage', path: second }),
      { code: 'unsafe_path' },
    );
  await requireSeparateTrees(
    { label: 'vault', path: join(root, 'v') },
    { label: 'storage', path: join(root, 's') },
  );
});

test('vault content is verified before it becomes visible and shared between points', async (t) => {
  const root = await workspace(t);
  const path = join(root, 'vault');
  await FileVault.initialize(path, { vaultId: id(), createdAt: new Date().toISOString() });
  const vault = await FileVault.open(path);
  const entry = { id: id(), size: 5, sha256: digest('hello') };
  await assert.rejects(
    vault.putBlob({ ...entry, sha256: digest('other') }, chunks('hel', 'lo'), never),
    {
      code: 'integrity_mismatch',
    },
  );
  await assert.rejects(vault.putBlob(entry, chunks('hello!'), never), {
    code: 'integrity_mismatch',
  });
  assert.equal(await vault.hasBlob(entry), false);
  const shard = join(path, 'blobs', entry.id.slice(0, 2));
  assert.deepEqual(await readdir(shard), [], 'a failed copy leaves no temporary file');
  await vault.putBlob(entry, chunks('hel', 'lo'), never);
  assert.equal(await vault.hasBlob(entry), true);
  assert.equal(await vault.blobDigest(entry, never), entry.sha256);
  assert.equal(await vault.blobDigest({ ...entry, size: 6 }, never), null);
  assert.equal(await vault.blobDigest({ ...entry, id: id() }, never), null);
  const read = [];
  for await (const chunk of vault.readBlob(entry)) read.push(chunk);
  assert.equal(Buffer.concat(read).toString(), 'hello');
  await assert.rejects(
    async () => {
      for await (const chunk of vault.readBlob({ ...entry, size: 9 })) assert.ok(chunk);
    },
    { code: 'integrity_mismatch' },
  );
});

test('a staged point is invisible until one atomic publication and never alters others', async (t) => {
  const root = await workspace(t);
  const path = join(root, 'vault');
  const identity = await FileVault.initialize(path, {
    vaultId: id(),
    createdAt: new Date().toISOString(),
  });
  const vault = await FileVault.open(path);
  const pointId = id();
  const stage = await vault.stage(pointId, 1);
  const inventory = await stage.write(INVENTORY_FILE, lines('{"a":1}', '{"b":2}'), never);
  assert.equal(inventory.lines, 2);
  const users = await stage.write('tables/arkvory_users.ndjson', lines('{"id":1}'), never);
  await assert.rejects(stage.write('../escape.ndjson', lines('x'), never), { code: 'unsafe_path' });
  assert.equal(await vault.point(pointId), null);
  assert.deepEqual(await vault.pointIds(), []);
  const value = manifest({
    pointId,
    vaultId: identity.vaultId,
    inventory: { count: 0, contentBytes: '0', sha256: inventory.sha256, bytes: inventory.bytes },
    tables: [{ name: 'arkvory_users', rows: 1, sha256: users.sha256, bytes: users.bytes }],
  });
  assert.equal(await stage.commit(value), 'committed');
  await stage.discard();
  assert.deepEqual(await vault.point(pointId), value);
  assert.deepEqual(await vault.pointIds(), [pointId]);
  const second = await vault.stage(pointId, 2);
  await second.write(INVENTORY_FILE, lines('{"c":3}'), never);
  assert.equal(await second.commit(value), 'exists', 'a point id is published once');
  await second.discard();
  assert.deepEqual(await readdir(join(path, 'points', '.staging')), []);
  assert.deepEqual(await vault.point(pointId), value);
  const collected = [];
  for await (const line of vault.lines(pointId, INVENTORY_FILE, inventory, never))
    collected.push(line);
  assert.deepEqual(collected, ['{"a":1}', '{"b":2}']);
  await assert.rejects(
    async () => {
      for await (const line of vault.lines(
        pointId,
        INVENTORY_FILE,
        { ...inventory, bytes: '1' },
        never,
      ))
        assert.ok(line);
    },
    { code: 'integrity_mismatch' },
  );
  assert.throws(() => vault.pointPath(pointId, 'tables/../../vault.json'), { code: 'unsafe_path' });
  // A manifest edited after commit no longer matches COMMITTED.
  const file = join(path, 'points', pointId, 'manifest.json');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"rows": 1', '"rows": 2'));
  await assert.rejects(vault.point(pointId), { code: 'invalid_manifest' });
  assert.ok(new BackupFailure('busy', 'x') instanceof Error);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, readFile, readdir, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INVENTORY_FILE, inventoryLine } from '@proanima/arkvory-domain';
import { VerifyPoint } from '@proanima/arkvory-application';
import { FileVault, encryptedSize, keyFileSource } from '@proanima/arkvory-infrastructure';
import { vaultIn } from './backup-vault-helpers.mjs';

const never = { throwIfAborted() {} };
const MARKER = 'TOP-SECRET-MARKER-4f1c9a';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* once(value) {
  yield value;
}
async function* lines(values) {
  for (const value of values) yield value;
}

/** A blob whose bytes contain the marker, stored once as a capture would copy it. */
async function marked(vault, extra = 0) {
  const content = Buffer.concat([Buffer.from(`${MARKER} blob `), randomBytes(extra)]);
  const entry = { id: randomUUID(), size: content.length, sha256: sha(content) };
  await vault.putBlob(entry, once(content), never);
  return { entry, content };
}

/** A committed point whose table rows contain the marker. */
async function markedPoint(vault, identity, entries) {
  const pointId = randomUUID();
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
  const staged = await vault.stage(pointId, 1);
  const inventory = await staged.write(INVENTORY_FILE, lines(sorted.map(inventoryLine)), never);
  const rows = [`{"id":1,"name":"${MARKER} row"}`, `{"id":2,"name":"second"}`];
  const users = await staged.write('tables/arkvory_users.ndjson', lines(rows), never);
  const takenAt = new Date().toISOString();
  const manifest = {
    format: 'arkvory-backup-point',
    version: 1,
    pointId,
    jobId: randomUUID(),
    vaultId: identity.vaultId,
    sourceInstanceId: randomUUID(),
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
    tables: [{ name: 'arkvory_users', rows: 2, sha256: users.sha256, bytes: users.bytes }],
    excludedTables: [],
    pendingUploads: 0,
  };
  assert.equal(await staged.commit(manifest), 'committed');
  await staged.discard();
  return manifest;
}

async function filesOf(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const verify = async (vault, manifest, deep = true) =>
  (await new VerifyPoint(vault).run({ pointId: manifest.pointId, deep }, never))[0];

test('nothing of the catalog or the content is readable on the disk of an encrypted vault', async (t) => {
  for (const encrypted of [false, true]) {
    const { vault, identity, path } = await vaultIn(t, { encrypted });
    const { entry } = await marked(vault, 4096);
    const manifest = await markedPoint(vault, identity, [entry]);
    let found = 0;
    for (const file of await filesOf(path)) {
      const bytes = await readFile(file);
      if (bytes.includes(MARKER)) found++;
      // Identifiers of the catalog (the inventory) are content as well.
      if (!file.endsWith('vault.json') && bytes.includes(entry.id)) found++;
    }
    if (encrypted)
      assert.equal(found, 0, 'the marker or an inventory id is on the disk in the clear');
    else
      assert.ok(
        found >= 3,
        'the scan can see plain content: the blob, the table and the inventory',
      );
    const [verified] = await new VerifyPoint(vault).run(
      { pointId: manifest.pointId, deep: true },
      never,
    );
    assert.equal(verified.ok, true);
  }
});

test('an encrypted vault is read back: blobs, tables, inventory, manifest and sizes', async (t) => {
  const { vault, identity, path, keys } = await vaultIn(t, { encrypted: true });
  const { entry, content } = await marked(vault, 3 * 1024 * 1024 + 11);
  const manifest = await markedPoint(vault, identity, [entry]);
  assert.equal(await vault.hasBlob(entry), true);
  assert.equal(
    (await stat(join(path, 'blobs', entry.id.slice(0, 2), entry.id))).size,
    encryptedSize(entry.size),
  );
  assert.equal(await vault.blobDigest(entry, never), entry.sha256);
  const read = [];
  for await (const chunk of vault.readBlob(entry)) read.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(read), content);
  assert.deepEqual(await vault.point(manifest.pointId), manifest);
  const rows = [];
  for await (const line of vault.lines(
    manifest.pointId,
    'tables/arkvory_users.ndjson',
    manifest.tables[0],
    never,
  ))
    rows.push(JSON.parse(line));
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2],
  );
  const digest = await vault.digest(manifest.pointId, 'tables/arkvory_users.ndjson', never);
  assert.deepEqual(
    { sha256: digest.sha256, bytes: digest.bytes, lines: digest.lines },
    { sha256: manifest.tables[0].sha256, bytes: manifest.tables[0].bytes, lines: 2 },
  );
  assert.equal((await verify(vault, manifest)).ok, true);
  // Another process opens the same vault with the recovery kit instead of the agent key.
  const kit = join(path, '..', 'kit.txt');
  await writeFile(kit, `Recovery key: ${keys.recovery}\n`);
  const reopened = await FileVault.open(path, undefined, keyFileSource(kit));
  assert.deepEqual(await reopened.point(manifest.pointId), manifest);
  assert.equal(await reopened.blobDigest(entry, never), entry.sha256);
  // A blob that is already there is recognized, so a capture shares it between points.
  assert.equal(await reopened.hasBlob(entry), true);
});

test('without the right key an encrypted vault opens nothing', async (t) => {
  const { vault, identity, path, keys } = await vaultIn(t, { encrypted: true });
  const { entry } = await marked(vault);
  const manifest = await markedPoint(vault, identity, [entry]);
  const blind = await FileVault.open(path);
  for (const action of [
    () => blind.point(manifest.pointId),
    () => blind.pointIds(),
    () => blind.blobDigest(entry, never),
    () => blind.hasBlob(entry),
    () => blind.putBlob(entry, once(Buffer.alloc(0)), never),
    () => blind.stage(randomUUID(), 1),
    () => blind.listing(),
  ])
    await assert.rejects(action(), { code: 'vault_key_missing' });
  const other = await vaultIn(t, { encrypted: true });
  const wrong = await FileVault.open(path, undefined, keyFileSource(other.keys.keyFile));
  await assert.rejects(wrong.point(manifest.pointId), { code: 'vault_key_invalid' });
  await assert.rejects(wrong.stage(randomUUID(), 1), { code: 'vault_key_invalid' });
  assert.ok(keys.agent);
  // The identity needs no key: a vault can be told apart from an empty mount without one.
  assert.equal((await blind.describe()).encryption, 'aes-256-gcm-v1');
});

test('changed, cut, swapped or deleted files of a point show in its verification', async (t) => {
  const { vault, identity, path } = await vaultIn(t, { encrypted: true });
  const a = await marked(vault, 600);
  const b = await marked(vault, 600);
  assert.equal(a.entry.size, b.entry.size, 'the two blobs have the same size');
  const manifest = await markedPoint(vault, identity, [a.entry, b.entry]);
  assert.equal((await verify(vault, manifest)).ok, true);

  const blobFile = (entry) => join(path, 'blobs', entry.id.slice(0, 2), entry.id);
  const backup = async (file) => {
    const copy = `${file}.save`;
    await copyFile(file, copy);
    return () => copyFile(copy, file);
  };
  const flip = async (file, offset) => {
    const bytes = await readFile(file);
    bytes[offset] ^= 1;
    await writeFile(file, bytes);
  };
  const codes = async (deep = true) =>
    (await verify(vault, manifest, deep)).problems.map((p) => `${p.code}:${p.subject}`);
  const base = join(path, 'points', manifest.pointId);

  // A flipped byte in a blob is found by the deep check; the structural one only sees sizes.
  let restore = await backup(blobFile(a.entry));
  await flip(blobFile(a.entry), 100);
  assert.deepEqual(await codes(), [`blob_mismatch:${a.entry.id}`]);
  assert.equal((await verify(vault, manifest, false)).ok, true);
  await restore();

  // A valid blob of the same size put in the place of another one does not authenticate there.
  restore = await backup(blobFile(a.entry));
  await copyFile(blobFile(b.entry), blobFile(a.entry));
  assert.deepEqual(await codes(), [`blob_mismatch:${a.entry.id}`]);
  await restore();

  // A cut or deleted blob is a missing one.
  restore = await backup(blobFile(b.entry));
  await truncate(blobFile(b.entry), (await stat(blobFile(b.entry))).size - 1);
  assert.deepEqual(await codes(false), [`blob_missing:${b.entry.id}`]);
  await restore();

  // A table or the inventory that changed, and a table of another point, do not authenticate.
  const table = join(base, 'tables', 'arkvory_users.ndjson');
  restore = await backup(table);
  await flip(table, 80);
  assert.deepEqual(await codes(false), ['file_mismatch:tables/arkvory_users.ndjson']);
  await restore();
  const stranger = await markedPoint(vault, identity, [a.entry]);
  await copyFile(join(path, 'points', stranger.pointId, 'tables', 'arkvory_users.ndjson'), table);
  assert.deepEqual(await codes(false), ['file_mismatch:tables/arkvory_users.ndjson']);
  await restore();
  const inventory = join(base, INVENTORY_FILE);
  restore = await backup(inventory);
  await flip(inventory, 60);
  assert.deepEqual(await codes(false), ['file_mismatch:inventory.ndjson']);
  await restore();
  assert.equal((await verify(vault, manifest)).ok, true);
});

test('a manifest that changed, or a record of another point, makes the point damaged', async (t) => {
  const { vault, identity, path } = await vaultIn(t, { encrypted: true });
  const { entry } = await marked(vault);
  const first = await markedPoint(vault, identity, [entry]);
  const second = await markedPoint(vault, identity, [entry]);
  const file = join(path, 'points', first.pointId, 'manifest.json');
  const original = await readFile(file);
  const damaged = Buffer.from(original);
  damaged[60] ^= 1;
  await writeFile(file, damaged);
  await assert.rejects(vault.point(first.pointId), { code: 'invalid_manifest' });
  const listing = await vault.listing();
  assert.deepEqual(listing.damaged, [first.pointId]);
  assert.deepEqual(
    listing.committed.map((m) => m.pointId),
    [second.pointId],
  );
  await writeFile(file, original);
  // The manifest of one point under the name of another is refused as well.
  await copyFile(join(path, 'points', second.pointId, 'manifest.json'), file);
  await assert.rejects(vault.point(first.pointId), { code: 'invalid_manifest' });
});

test('points and blobs of another vault do not open here, even with the same names', async (t) => {
  const first = await vaultIn(t, { encrypted: true });
  const second = await vaultIn(t, { encrypted: true });
  const { entry, content } = await marked(first.vault);
  await first.vault.putBlob(entry, once(content), never);
  const manifest = await markedPoint(first.vault, first.identity, [entry]);
  await second.vault.putBlob(entry, once(content), never);
  const here = join(first.path, 'blobs', entry.id.slice(0, 2), entry.id);
  const there = join(second.path, 'blobs', entry.id.slice(0, 2), entry.id);
  await copyFile(here, there);
  await assert.rejects(second.vault.blobDigest(entry, never), { code: 'integrity_mismatch' });
  assert.ok(manifest);
});

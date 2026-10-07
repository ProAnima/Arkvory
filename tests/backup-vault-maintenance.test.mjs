import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INVENTORY_FILE, inventoryLine } from '@proanima/arkvory-domain';
import { VerifyPoint } from '@proanima/arkvory-application';
import { PacedContentSource, encryptedSize } from '@proanima/arkvory-infrastructure';
import { blob, point, time, vaultIn } from './backup-vault-helpers.mjs';

const never = { throwIfAborted() {} };
/** The same behaviour is required of a plain and of an encrypted vault (ADR 0070). */
const modes = [
  { label: 'plain', encrypted: false },
  { label: 'encrypted', encrypted: true },
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const { label, encrypted } of modes)
  test(`prune deletes only content no remaining point lists, and attempt leftovers (${label})`, async (t) => {
    const { vault, identity, path } = await vaultIn(t, { encrypted });
    const shared = await blob(vault);
    const old = await blob(vault, 100);
    const kept = await blob(vault);
    const orphan = await blob(vault, 7);
    const first = await point(vault, identity, [shared, old], time(0));
    const second = await point(vault, identity, [shared, kept], time(1));
    // A crashed write and a crashed attempt leave files nobody will ever publish.
    await writeFile(
      join(path, 'blobs', kept.id.slice(0, 2), `.${kept.id}.${randomUUID()}.tmp`),
      'x',
    );
    await vault.stage(randomUUID(), 1);
    assert.equal(await vault.sharedBytes(second, first, never), BigInt(shared.size));
    await vault.forget(first.pointId);
    assert.equal(await vault.point(first.pointId), null);
    const pruned = await vault.prune([second], never);
    // Prune reports the bytes it freed on disk: an encrypted file is larger than its content.
    const stored = (size) => (encrypted ? encryptedSize(size) : size);
    assert.deepEqual(pruned, { blobs: 2, bytes: BigInt(stored(old.size) + stored(orphan.size)) });
    for (const entry of [shared, kept]) assert.equal(await vault.hasBlob(entry), true);
    for (const entry of [old, orphan]) assert.equal(await vault.hasBlob(entry), false);
    assert.deepEqual(await readdir(join(path, 'points', '.staging')), []);
    const shard = await readdir(join(path, 'blobs', kept.id.slice(0, 2)));
    assert.equal(
      shard.some((name) => name.endsWith('.tmp')),
      false,
    );
    const [verified] = await new VerifyPoint(vault).run(
      { pointId: second.pointId, deep: true },
      never,
    );
    assert.equal(verified.ok, true);
    // Repeating prune is a no-op.
    assert.deepEqual(await vault.prune([second], never), { blobs: 0, bytes: 0n });
  });

for (const { label, encrypted } of modes)
  test(`listing separates committed, unfinished forgets and damaged points (${label})`, async (t) => {
    const { vault, identity, path } = await vaultIn(t, { encrypted });
    const entry = await blob(vault);
    const committed = await point(vault, identity, [entry], time(0));
    const unfinished = await point(vault, identity, [entry], time(1));
    const damaged = await point(vault, identity, [entry], time(2));
    const foreign = await point(vault, identity, [entry], time(3), randomUUID());
    await rm(join(path, 'points', unfinished.pointId, 'COMMITTED'));
    await writeFile(join(path, 'points', damaged.pointId, 'manifest.json'), '{}');
    const listing = await vault.listing();
    assert.equal(listing.identity.vaultId, identity.vaultId);
    assert.deepEqual(
      listing.committed.map((m) => m.pointId).sort(),
      [committed.pointId, foreign.pointId].sort(),
    );
    assert.deepEqual(listing.uncommitted, [unfinished.pointId]);
    assert.deepEqual(listing.damaged, [damaged.pointId]);
    // Forget is repeatable: a directory without COMMITTED is removed, a missing one is fine.
    await vault.forget(unfinished.pointId);
    await vault.forget(unfinished.pointId);
    await assert.rejects(stat(join(path, 'points', unfinished.pointId)), { code: 'ENOENT' });
  });

// Plain only: the test forges the files, and an encrypted file cannot be forged without the key.
test('prune deletes nothing when an inventory differs from its manifest or is out of order', async (t) => {
  const { vault, identity, path } = await vaultIn(t);
  const a = await blob(vault);
  const b = await blob(vault);
  const orphan = await blob(vault);
  const kept = await point(vault, identity, [a, b], time(0));
  const file = join(path, 'points', kept.pointId, INVENTORY_FILE);
  // Dropping a line would hide content the point needs; the digest check refuses it.
  await writeFile(file, inventoryLine(a) + '\n');
  await assert.rejects(vault.prune([kept], never), { code: 'integrity_mismatch' });
  for (const entry of [a, b, orphan]) assert.equal(await vault.hasBlob(entry), true);
  const [low, high] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
  const reversed = [high, low].map(inventoryLine).join('\n') + '\n';
  await writeFile(file, reversed);
  const forged = {
    ...kept,
    inventory: {
      ...kept.inventory,
      sha256: sha(reversed),
      bytes: String(Buffer.byteLength(reversed)),
    },
  };
  await assert.rejects(vault.prune([forged], never), { code: 'invalid_manifest' });
  assert.equal(await vault.hasBlob(orphan), true);
});

for (const { label, encrypted } of modes)
  test(`prune merges more inventories than one fan-in through sorted union files (${label})`, async (t) => {
    const { vault, identity, path } = await vaultIn(t, { encrypted });
    const shared = await blob(vault, 4);
    const points = [];
    const own = [];
    for (let index = 0; index < 70; index++) {
      const entry = await blob(vault, 4);
      own.push(entry);
      points.push(await point(vault, identity, [shared, entry], time(index)));
    }
    const orphans = [await blob(vault, 4), await blob(vault, 4)];
    const pruned = await vault.prune(points, never);
    assert.deepEqual(pruned, {
      blobs: 2,
      bytes: BigInt(2 * (encrypted ? encryptedSize(4) : 4)),
    });
    for (const entry of [shared, ...own]) assert.equal(await vault.hasBlob(entry), true);
    for (const entry of orphans) assert.equal(await vault.hasBlob(entry), false);
    assert.deepEqual(await readdir(join(path, 'points', '.staging')), []);
  });

test('paced content waits so that bytes fit the configured rate without bursts', async () => {
  let now = 0;
  const sleeps = [];
  const source = {
    async *read() {
      yield Buffer.alloc(1000);
      now += 100;
      yield Buffer.alloc(1000);
    },
  };
  const paced = new PacedContentSource(
    source,
    1000,
    () => now,
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  );
  let total = 0;
  for await (const chunk of paced.read({ id: randomUUID(), size: 2000, sha256: 'a'.repeat(64) }))
    total += chunk.length;
  assert.equal(total, 2000);
  // One second of credit covers the first chunk; the second waits for the rest of its share.
  assert.deepEqual(sleeps, [900]);
  assert.throws(() => new PacedContentSource(source, 0), { code: 'invalid_argument' });
});

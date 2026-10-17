import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer as streamBytes } from 'node:stream/consumers';
import { ZipFile } from 'yazl';
import { Pool } from 'pg';
import { RestoreToEmptyTarget } from '@proanima/arkvory-application';
import {
  LocalContentSource,
  LocalRestoreStorage,
  MINIMUM_RESTORE_SCHEMA,
  PostgresRestoreDatabase,
  SCHEMA_VERSION,
} from '@proanima/arkvory-infrastructure';
import { openVault } from '../../apps/backup/dist/index.js';
import { setup, base } from './fixture.mjs';
import { capture, newVault, publish, sha, temporaryDatabase } from './backup-fixture.mjs';
import { MemoryBlobStore, portOnly } from '../memory-blobs.mjs';

const register = (f, id) =>
  f.app.inject({ method: 'POST', url: `${base}/artifacts/${id}/package`, headers: f.headers });

async function upack(manifest, entries, options = {}) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'upack.json', options);
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, options);
  zip.end(options);
  return streamBytes(zip.outputStream);
}

test('UPack registration reads ZIP64 and many-entry archives through the storage port', async (t) => {
  const f = await setup(t);
  const manifest = { name: 'engine', group: 'tools', version: '1.0.0' };
  const zip64 = await upack(manifest, [['package/a.bin', Buffer.alloc(70_000, 1)]], {
    forceZip64Format: true,
  });
  const forced = await publish(f, zip64);
  const registered = await register(f, forced.id);
  assert.equal(registered.statusCode, 200, registered.body);
  assert.deepEqual(registered.json().manifest, manifest);
  const files = Array.from({ length: 5000 }, (_, i) => [
    `package/f${String(i)}.txt`,
    Buffer.from('x'),
  ]);
  const many = await publish(f, await upack({ ...manifest, version: '1.0.1' }, files));
  assert.equal((await register(f, many.id)).statusCode, 200);
  // A blob gone from the storage is the storage's failure (503), not an invalid archive (400).
  const lost = await publish(f, await upack({ ...manifest, version: '1.0.2' }, []));
  await unlink(join(f.directory, 'blobs', lost.id));
  const failed = await register(f, lost.id);
  assert.equal(failed.statusCode, 503, failed.body);
  assert.equal(failed.json().code, 'unavailable');
});

test('capture and restore go through the port and keep the storage of each blob', async (t) => {
  const f = await setup(t);
  const published = [await publish(f), await publish(f, Buffer.alloc(0)), await publish(f)];
  const placed = published[2];
  // Placement is not wired yet (ADR 0083, N11): the row names a second storage directly.
  await f.catalog.pool.query("UPDATE arkvory_uploads SET storage_backend='volume-2' WHERE id=$1", [
    placed.id,
  ]);
  const reads = [];
  const { path: vaultPath } = await newVault(t);
  const result = await capture(f, vaultPath, 'port-only', (deps, source) => {
    const port = portOnly(source.blobs);
    const recording = {
      ...port,
      read: (id, size, range, backendId) => {
        reads.push({ id, backendId });
        return port.read(id, size, range, backendId);
      },
    };
    return { ...deps, content: new LocalContentSource(recording) };
  });
  assert.equal(result.outcome, 'created');
  assert.deepEqual(
    Object.fromEntries(reads.map((read) => [read.id, read.backendId])),
    Object.fromEntries(published.map(({ id }) => [id, id === placed.id ? 'volume-2' : 'default'])),
  );
  const database = await temporaryDatabase(t);
  const pool = new Pool({ connectionString: database.url, max: 3 });
  database.release(() => pool.end());
  const target = new MemoryBlobStore();
  const restore = new RestoreToEmptyTarget({
    vault: await openVault(vaultPath),
    database: new PostgresRestoreDatabase(pool),
    storage: new LocalRestoreStorage(target),
    identity: { now: () => new Date().toISOString() },
    releaseSchema: SCHEMA_VERSION,
    minimumSchema: MINIMUM_RESTORE_SCHEMA,
  });
  const report = await restore.run(
    { pointId: result.pointId, confirmed: true },
    { throwIfAborted() {} },
  );
  assert.equal(report.outcome, 'restored');
  for (const item of published) {
    assert.equal(sha(target.bytesOf(item.id)), sha(item.bytes));
    await target.exists(item.id, item.bytes.length, item === placed ? 'volume-2' : 'default');
  }
  const rows = await pool.query('SELECT id::text, storage_backend FROM arkvory_uploads');
  assert.equal(rows.rows.find((row) => row.id === placed.id).storage_backend, 'volume-2');
});

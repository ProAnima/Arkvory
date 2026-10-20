import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { createServer } from '../../apps/api/dist/index.js';
import { initializeVolume } from '../../apps/deploy/dist/storage-volume.js';
import { setup, base } from './fixture.mjs';
import {
  capture,
  newVault,
  publish,
  record,
  runBackup,
  scratch,
  temporaryDatabase,
} from './backup-fixture.mjs';

async function fixture(t) {
  const directory = await scratch(t, 'flatten-source', 'volume');
  await mkdir(directory);
  await initializeVolume({ directory, expectMount: false });
  const f = await setup(t, {
    storageReserveBytes: 0,
    storageBackends: [
      {
        id: 'volume-2',
        directory,
        enabled: true,
        mode: 'full',
        acceptsWrites: true,
        reserveBytes: 0,
      },
    ],
  });
  const first = await publish(f, Buffer.from('ordinary storage'));
  await f.catalog.pool.query(
    "INSERT INTO arkvory_storage_placement(repository,revision,rules,updated_by) VALUES('releases',1,$1,'test')",
    [
      JSON.stringify([
        { id: 'all', backendId: 'volume-2', packageGroup: null, minSizeBytes: null },
      ]),
    ],
  );
  const second = await publish(f, Buffer.from('separate storage'));
  assert.equal(
    (
      await f.catalog.pool.query('SELECT storage_backend FROM arkvory_uploads WHERE id=$1', [
        second.id,
      ])
    ).rows[0].storage_backend,
    'volume-2',
  );
  const modules = await scratch(t, 'flatten-modules', 'modules.json');
  await writeFile(
    modules,
    JSON.stringify({
      format: 1,
      modules: {
        'local-storage': { enabled: true, config: { instances: { 'volume-2': { directory } } } },
      },
    }),
  );
  const { path: vault } = await newVault(t);
  const point = await capture(f, vault, 'flatten', undefined, { ARKVORY_MODULES_FILE: modules });
  const database = await temporaryDatabase(t);
  const pool = new Pool({ connectionString: database.url, max: 2 });
  database.release(() => pool.end());
  const storage = await scratch(t, 'flatten-target', 'storage');
  const args = ['restore', '--vault', vault, '--point', point.pointId, '--storage', storage];
  const env = { ARKVORY_RESTORE_DATABASE_URL: database.url };
  return { f, database, pool, storage, args, env, published: [first, second] };
}

test('explicit default-storage restore plans without writes and serves all volumes without their configuration', async (t) => {
  const { f, database, pool, storage, args, env, published } = await fixture(t);
  const refused = await runBackup([...args, '--yes'], env);
  assert.equal(record(refused, 'backup.failed').errorCode, 'invalid_argument');
  const plan = await runBackup([...args, '--to-default-storage'], env);
  assert.equal(plan.code, 0, plan.stdout + plan.stderr);
  assert.equal(record(plan, 'backup.restore.planned').toDefaultStorage, true);
  await assert.rejects(access(storage), { code: 'ENOENT' });
  assert.equal((await pool.query("SELECT to_regclass('arkvory_uploads') AS t")).rows[0].t, null);
  const restored = await runBackup([...args, '--to-default-storage', '--yes'], env);
  assert.equal(restored.code, 0, restored.stdout + restored.stderr);
  assert.equal(record(restored, 'backup.restore.completed').toDefaultStorage, true);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM arkvory_uploads WHERE storage_backend <> 'default' OR parts_backend IS NOT NULL",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM arkvory_storage_placement')).rows[0].n,
    0,
  );
  const audit = await pool.query(
    "SELECT details FROM arkvory_security_audit WHERE action='backup.restored'",
  );
  assert.equal(audit.rows[0].details.toDefaultStorage, true);
  const app = await createServer({
    ...f.config,
    databaseUrl: database.url,
    dataDirectory: storage,
    storageBackends: [],
  });
  database.release(() => app.close());
  for (const item of published) {
    const response = await app.inject({
      method: 'GET',
      url: `${base}/artifacts/${item.id}/content`,
      headers: f.headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.rawPayload, item.bytes);
  }
  const again = await runBackup([...args, '--to-default-storage', '--yes'], env);
  assert.notEqual(again.code, 0, 'flattening must never overwrite a live target');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { serviceActions } from '@proanima/arkvory-domain';
import { GarbageCollector, RestoreToEmptyTarget } from '@proanima/arkvory-application';
import {
  LocalRestoreStorage,
  MINIMUM_RESTORE_SCHEMA,
  PostgresCleanup,
  PostgresCleanupSettings,
  PostgresOnlineCleanup,
  PostgresRestoreDatabase,
  PostgresStorageIdentities,
  SCHEMA_VERSION,
  localStorageBackends,
  probeStorageBackends,
} from '@proanima/arkvory-infrastructure';
import { openVault } from '../../apps/backup/dist/index.js';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, base, descriptor } from './fixture.mjs';
import { capture, newVault, temporaryDatabase } from './backup-fixture.mjs';
import { validateResponse } from '../api-schema.mjs';

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function scratch(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

/** An installation with a second volume `volume-2` (the base implementation of N11). */
async function twoVolumes(t, volume = {}) {
  const second = await scratch(t, 'arkvory-volume-2-');
  const backend = {
    id: 'volume-2',
    directory: second,
    enabled: true,
    mode: 'full',
    acceptsWrites: true,
    reserveBytes: 0,
    ...volume,
  };
  const f = await setup(t, { storageBackends: [backend], storageReserveBytes: 0 });
  return { f, second, backend };
}

/** A service key with every storage action on `releases`: placement needs `storage.manage`. */
async function manager(f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const url = await f.listen();
  const root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  const bindings = [{ resource: { kind: 'repository', id: 'releases' }, actions: serviceActions }];
  const account = await root.createServiceAccount('placement-manager', bindings);
  const key = await root.issueServiceKey(account.id, randomUUID(), { name: 'placement', bindings });
  const client = new ArkvoryClient(url, () => key.secret);
  await client.activateServiceKey();
  return { client, url, secret: key.secret, headers: { authorization: 'Bearer ' + key.secret } };
}

const everything = [{ id: 'all', backendId: 'volume-2', packageGroup: null, minSizeBytes: null }];

async function createUpload(f, bytes) {
  const made = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: descriptor(bytes),
  });
  assert.equal(made.statusCode, 201, made.body);
  return made.json();
}

async function publish(f, bytes = randomBytes(4096)) {
  const upload = await createUpload(f, bytes);
  const done = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${upload.id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  return { id: upload.id, bytes, storageBackend: done.json().storageBackend };
}

async function download(f, id) {
  return f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers });
}

const putPart = (f, id, bytes) =>
  f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': sha(bytes),
    },
    payload: bytes,
  });

test('a placement switch affects only new uploads; earlier ones stay readable where they are', async (t) => {
  const { f, second } = await twoVolumes(t);
  const { client, headers, url: server, secret } = await manager(f);
  const before = await publish(f);
  assert.equal(before.storageBackend, 'default');
  const url = `${base}/storage/placement`;
  const initial = await f.app.inject({ url, headers });
  validateResponse('/api/v1/repositories/{repository}/storage/placement', 'get', initial);
  assert.deepEqual(initial.json(), {
    revision: 0,
    rules: [],
    updatedAt: null,
    backends: [
      { id: 'default', state: 'accepting' },
      { id: 'volume-2', state: 'accepting' },
    ],
  });
  const saved = await client.setStoragePlacement('releases', 0, everything);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.rules, everything);
  const placed = await publish(f);
  assert.equal(placed.storageBackend, 'volume-2');
  assert.equal(await exists(join(second, 'blobs', placed.id)), true);
  assert.equal(await exists(join(f.directory, 'blobs', placed.id)), false);
  // Back to default: the placed upload is not moved and stays readable from its storage.
  await client.setStoragePlacement('releases', 1, []);
  const after = await publish(f);
  assert.equal(after.storageBackend, 'default');
  for (const item of [before, placed, after]) {
    const response = await download(f, item.id);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(sha(response.rawPayload), sha(item.bytes));
  }
  assert.equal(
    (
      await f.catalog.pool.query('SELECT storage_backend FROM arkvory_uploads WHERE id=$1', [
        placed.id,
      ])
    ).rows[0].storage_backend,
    'volume-2',
  );
  // An unknown storage and a stale revision are refused; the writer key has no storage rights.
  const unknown = await f.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { expectedRevision: 2, rules: [{ ...everything[0], backendId: 'volume-9' }] },
  });
  assert.equal(unknown.statusCode, 400, unknown.body);
  assert.equal(unknown.json().reason, 'backend_unknown');
  const stale = await f.app.inject({
    method: 'PUT',
    url,
    headers,
    payload: { expectedRevision: 1, rules: [] },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().reason, 'revision_mismatch');
  assert.equal((await f.app.inject({ url, headers: f.headers })).statusCode, 403);
  const events = await client.storageEvents('releases');
  assert.ok(events.items.some((event) => event.code === 'storage.placement_updated'));
  // arkvoryctl reads and replaces the same policy.
  const home = await scratch(t, 'arkvory-cli-');
  const env = {
    ...process.env,
    ARKVORY_CLI_HOME: home,
    ARKVORY_BASE_URL: server,
    ARKVORY_TOKEN: secret,
  };
  delete env.ARKVORY_TOKEN_FILE;
  const cli = async (...args) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [
            resolve('apps/cli/dist/main.js'),
            'storage',
            'placement',
            '--repository',
            'releases',
            ...args,
            '--json',
          ],
          { env, windowsHide: true, timeout: 30000 },
        )
      ).stdout,
    );
  assert.equal((await cli()).revision, 2);
  const rules = join(home, 'rules.json');
  await writeFile(rules, JSON.stringify(everything));
  const replaced = await cli('--revision', '2', '--file', rules);
  assert.equal(replaced.revision, 3);
  assert.deepEqual(replaced.rules, everything);
});

test('a storage that is down or takes no data sends new uploads to default; nothing fails', async (t) => {
  const { f, second, backend } = await twoVolumes(t);
  const { client, headers } = await manager(f);
  await client.setStoragePlacement('releases', 0, everything);
  const placed = await publish(f);
  assert.equal(placed.storageBackend, 'volume-2');
  // An upload in parts started in volume-2 before it stops taking data.
  const halfway = randomBytes(1024);
  const pending = await createUpload(f, halfway);
  assert.equal(pending.storageBackend, 'volume-2');
  assert.equal((await putPart(f, pending.id, halfway)).statusCode, 204);
  // The volume goes away: the restarted writer finds no storage there and keeps running.
  const moved = second + '-gone';
  await f.app.close();
  await rename(second, moved);
  t.after(() => removeTestDirectory(moved));
  await f.restart();
  const fallback = await publish(f);
  assert.equal(fallback.storageBackend, 'default');
  const unreadable = await download(f, placed.id);
  assert.equal(unreadable.statusCode, 503, unreadable.body);
  assert.equal(unreadable.json().code, 'unavailable');
  const metrics = (await f.app.inject({ url: '/health/metrics', headers: f.headers })).body;
  assert.match(metrics, /arkvory_storage_backend_up\{backend="volume-2"\} 0/);
  assert.match(
    metrics,
    /arkvory_storage_placement_fallback_total\{backend="volume-2",reason="unavailable"\} 1/,
  );
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  // Back again, but no longer taking data: reads work, new uploads still go to default.
  await f.app.close();
  await rename(moved, second);
  Object.assign(backend, { acceptsWrites: false });
  await f.restart();
  assert.equal((await download(f, placed.id)).statusCode, 200);
  assert.equal((await publish(f)).storageBackend, 'default');
  // The pending upload is not moved: a new part is refused, the accepted one finishes in default.
  const refused = await putPart(f, pending.id, halfway);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().reason, 'backend_read_only');
  const completed = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${pending.id}/complete`,
    headers: f.headers,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().storageBackend, 'default');
  const row = (
    await f.catalog.pool.query(
      'SELECT storage_backend,parts_backend FROM arkvory_uploads WHERE id=$1',
      [pending.id],
    )
  ).rows[0];
  assert.deepEqual(row, { storage_backend: 'default', parts_backend: 'volume-2' });
  assert.equal(sha((await download(f, pending.id)).rawPayload), sha(halfway));
  assert.equal(await exists(join(second, 'parts', pending.id)), true, 'parts stay until cleanup');
  const view = await f.app.inject({ url: `${base}/storage/placement`, headers });
  assert.deepEqual(view.json().backends.at(-1), { id: 'volume-2', state: 'not_accepting' });
});

async function openStorages(f, backend) {
  const storages = localStorageBackends(f.directory, 0, [backend]);
  await probeStorageBackends(storages, new PostgresStorageIdentities(f.catalog.pool), {
    create: false,
  });
  return storages;
}

test('cleanup removes content and parts in the storage that holds each, across volumes', async (t) => {
  const { f, second, backend } = await twoVolumes(t);
  const { client, headers } = await manager(f);
  await client.setStoragePlacement('releases', 0, everything);
  // A part in volume-2, finished in default after volume-2 stopped taking data.
  const bytes = randomBytes(512);
  const switched = await createUpload(f, bytes);
  assert.equal((await putPart(f, switched.id, bytes)).statusCode, 204);
  const cancelled = await publish(f);
  const deleted = await f.app.inject({
    method: 'DELETE',
    url: `${base}/artifacts/${cancelled.id}`,
    headers,
    payload: { expectedAnnotationRevision: 0 },
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  Object.assign(backend, { acceptsWrites: false });
  await f.restart();
  const done = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${switched.id}/complete`,
    headers: f.headers,
  });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(await exists(join(second, 'blobs', cancelled.id)), true);
  // Offline cleanup with the storages of the installation: volume-2 is open and recorded.
  const storages = await openStorages(f, backend);
  assert.equal(storages.state('volume-2'), 'not_accepting');
  await f.catalog.pool.query("UPDATE arkvory_uploads SET cancelled_at=now()-interval '2 days'");
  const result = await new GarbageCollector(new PostgresCleanup(f.catalog.pool), storages, {
    throwIfAborted() {},
  }).run(new Date().toISOString());
  assert.ok(result.collected >= 1, JSON.stringify(result));
  assert.equal(await exists(join(second, 'blobs', cancelled.id)), false);
  assert.equal(await exists(join(second, 'parts', switched.id)), false);
  assert.equal(sha((await download(f, switched.id)).rawPayload), sha(bytes));
  // Online cleanup: a storage that is not available keeps its files, deferred until it is back.
  const other = await createUpload(f, bytes);
  await f.catalog.pool.query("UPDATE arkvory_uploads SET storage_backend='volume-2' WHERE id=$1", [
    other.id,
  ]);
  await new PostgresCleanupSettings(f.catalog.pool).save(
    { principal: { id: 'test' }, repository: 'releases', actions: ['storage.manage'] },
    0,
    { enabled: true, graceHours: 0, batchSize: 100, intervalSeconds: 86400, delayMilliseconds: 0 },
  );
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET status='cancelled',cancelled_at=now()-interval '1 hour' WHERE id=$1",
    [other.id],
  );
  await writeFile(join(second, 'blobs', other.id), bytes);
  const sweep = async (blobs) => {
    await f.catalog.pool.query(
      'UPDATE arkvory_cleanup_settings SET next_run_at=now(),last_run_at=NULL',
    );
    await f.catalog.pool.query("UPDATE arkvory_uploads SET gc_checked_at='1970-01-01'");
    await new PostgresOnlineCleanup(f.catalog.pool, blobs).tick(() => true);
  };
  storages.mark('volume-2', 'probe_failed');
  await sweep(storages);
  assert.equal(await exists(join(second, 'blobs', other.id)), true);
  const reclaimed = async () =>
    (await f.catalog.pool.query('SELECT reclaimed FROM arkvory_uploads WHERE id=$1', [other.id]))
      .rows[0].reclaimed;
  assert.equal(await reclaimed(), false);
  storages.mark('volume-2', null);
  await sweep(storages);
  assert.equal(await exists(join(second, 'blobs', other.id)), false);
  assert.equal(await reclaimed(), true);
});

test('a backup of two volumes restores each blob into the volume its upload names', async (t) => {
  const { f, backend } = await twoVolumes(t);
  const { client } = await manager(f);
  const first = await publish(f);
  await client.setStoragePlacement('releases', 0, everything);
  const placed = await publish(f);
  assert.equal(placed.storageBackend, 'volume-2');
  // The backup agent reads the instances from the same modules file as the other processes.
  const modules = join(await scratch(t, 'arkvory-modules-'), 'modules.json');
  const config = (directory) => ({
    format: 1,
    modules: {
      'local-storage': { enabled: true, config: { instances: { 'volume-2': { directory } } } },
    },
  });
  await writeFile(modules, JSON.stringify(config(backend.directory)));
  const { path: vaultPath } = await newVault(t);
  const result = await capture(f, vaultPath, 'two-volumes', undefined, {
    ARKVORY_MODULES_FILE: modules,
  });
  assert.equal(result.outcome, 'created');
  const database = await temporaryDatabase(t);
  const pool = new Pool({ connectionString: database.url, max: 3 });
  database.release(() => pool.end());
  const target = await scratch(t, 'arkvory-restore-');
  const restore = async (storages, confirmed) =>
    new RestoreToEmptyTarget({
      vault: await openVault(vaultPath),
      database: new PostgresRestoreDatabase(pool),
      storage: new LocalRestoreStorage(storages),
      identity: { now: () => new Date().toISOString() },
      releaseSchema: SCHEMA_VERSION,
      minimumSchema: MINIMUM_RESTORE_SCHEMA,
    }).run({ pointId: result.pointId, confirmed }, { throwIfAborted() {} });
  // A target without the second volume is refused before anything is written.
  await assert.rejects(restore(localStorageBackends(join(target, 'default'), 0, []), true), {
    code: 'invalid_argument',
  });
  assert.equal(await exists(join(target, 'default')), false);
  const restored = { ...backend, directory: join(target, 'volume-2') };
  const report = await restore(localStorageBackends(join(target, 'default'), 0, [restored]), true);
  assert.equal(report.outcome, 'restored');
  assert.equal(
    sha(await readFile(join(target, 'volume-2', 'blobs', placed.id))),
    sha(placed.bytes),
  );
  assert.equal(await exists(join(target, 'default', 'blobs', first.id)), true);
  assert.equal(await exists(join(target, 'default', 'blobs', placed.id)), false);
  const rows = await pool.query('SELECT rules FROM arkvory_storage_placement');
  assert.deepEqual(rows.rows[0].rules, everything, 'the placement is part of the backup');
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM arkvory_storage_backends')).rows[0].n,
    0,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { FileVault } from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { setup, create, base } from './fixture.mjs';
import {
  newVault,
  publish,
  record,
  runBackup,
  scratch,
  sha,
  sourceEnv,
  temporaryDatabase,
} from './backup-fixture.mjs';

const password = 'long-private-password';

async function identities(f) {
  const user = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'alice', password },
  });
  assert.equal(user.statusCode, 201, user.body);
  const group = await f.app.inject({
    method: 'POST',
    url: '/api/v1/access-groups',
    headers: f.headers,
    payload: { name: 'readers' },
  });
  const groupId = group.json().id;
  for (const request of [
    { url: `/api/v1/access-groups/${groupId}/grants/releases`, payload: { access: 'read' } },
    { url: `/api/v1/access-groups/${groupId}/members/${user.json().id}` },
  ])
    assert.equal(
      (await f.app.inject({ method: 'PUT', headers: f.headers, ...request })).statusCode,
      204,
    );
  const session = (await login(f.app)).json().token;
  const pat = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/tokens',
    headers: { authorization: `Bearer ${session}` },
    payload: { name: 'ci' },
  });
  assert.equal(pat.statusCode, 201, pat.body);
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: ['artifact.list', 'artifact.read'],
    },
  ];
  const account = await root.createServiceAccount('restore-reader', bindings);
  const key = await root.issueServiceKey(account.id, randomUUID(), { name: 'reader', bindings });
  const port = f.app.server.address().port;
  await new ArkvoryClient('http://127.0.0.1:' + port, () => key.secret).activateServiceKey();
  return { session, pat: pat.json().token, serviceKey: key.secret };
}
const login = (app) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { name: 'alice', password } });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function assets(f) {
  const ids = [];
  for (const text of ['first revision', 'second revision']) {
    const { id } = await publish(f, Buffer.from(text));
    ids.push(id);
    const assigned = await f.app.inject({
      method: 'PUT',
      url: `${base}/asset`,
      headers: f.headers,
      payload: { path: 'tools/setup.bin', artifactId: id, expectedRevision: ids.length - 1 },
    });
    assert.equal(assigned.statusCode, 200, assigned.body);
  }
  // A restore of revision 1 creates revision 3 with a self-reference: a deferred column.
  const restored = await f.app.inject({
    method: 'POST',
    url: `${base}/asset/restore`,
    headers: f.headers,
    payload: { path: 'tools/setup.bin', sourceRevision: 1, expectedRevision: 2 },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  return ids;
}

async function restoredServer(target, f, dataDirectory) {
  const app = await createServer({ ...f.config, databaseUrl: target.url, dataDirectory });
  target.release(() => app.close());
  return app;
}

test('a captured point restores into an empty database and storage and serves the same catalog', async (t) => {
  const f = await setup(t);
  const credentials = await identities(f);
  const published = [await publish(f), await publish(f, Buffer.alloc(0)), await publish(f)];
  const assetIds = await assets(f);
  const pending = (await create(f, Buffer.from('never finished'))).json().id;
  const { path: vault } = await newVault(t);
  const env = sourceEnv(f);

  const captured = await runBackup(
    ['capture', '--vault', vault, '--idempotency-key', 'nightly-1'],
    env,
  );
  assert.equal(captured.code, 0, captured.stdout + captured.stderr);
  const done = record(captured, 'backup.capture.completed');
  assert.equal(done.outcome, 'created');
  assert.equal(done.blobs, published.length + assetIds.length);
  assert.deepEqual(
    captured.records.filter((r) => r.code === 'backup.phase').map((r) => r.phase),
    ['barrier', 'pins', 'tables', 'blobs', 'manifest', 'commit', 'done'],
  );
  t.diagnostic(`capture ${done.durationMs} ms, ${done.blobs} blobs, ${done.rows} rows`);
  const replay = await runBackup(
    ['capture', '--vault', vault, '--idempotency-key', 'nightly-1'],
    env,
  );
  assert.equal(record(replay, 'backup.capture.completed').outcome, 'existing');
  assert.equal(record(replay, 'backup.capture.completed').pointId, done.pointId);

  const listed = await runBackup(['list', '--vault', vault]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(
    listed.records.filter((r) => r.code === 'backup.point').map((r) => r.pointId),
    [done.pointId],
  );
  for (const depth of [[], ['--deep']]) {
    const verified = await runBackup(['verify', '--vault', vault, ...depth]);
    assert.equal(verified.code, 0, verified.stdout);
    assert.equal(record(verified, 'backup.verify.point').outcome, 'verified');
  }

  const database = await temporaryDatabase(t);
  const databaseUrl = database.url;
  const storage = await scratch(t, 'restore', 'storage');
  const restoreArgs = ['restore', '--vault', vault, '--point', done.pointId, '--storage', storage];
  const target = { ARKVORY_RESTORE_DATABASE_URL: databaseUrl };
  const planned = await runBackup(restoreArgs, target);
  assert.equal(planned.code, 0, planned.stdout + planned.stderr);
  assert.equal(record(planned, 'backup.restore.planned').outcome, 'planned');
  await assert.rejects(access(storage), { code: 'ENOENT' });
  const report = join(storage, '..', 'report.json');
  const restored = await runBackup([...restoreArgs, '--yes', '--report', report], target);
  assert.equal(restored.code, 0, restored.stdout + restored.stderr);
  const completed = record(restored, 'backup.restore.completed');
  t.diagnostic(`restore ${completed.durationMs} ms`);
  assert.equal(completed.cancelledUploads, 1);
  assert.equal(completed.revokedTokens, 1);
  assert.equal(completed.revokedServiceKeys, 1);
  const document = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(document.outcome, 'restored');
  assert.equal(document.pointId, done.pointId);

  const app = await restoredServer(database, f, storage);
  const listing = await app.inject({ url: `${base}/artifacts?limit=100`, headers: f.headers });
  assert.equal(listing.statusCode, 200, listing.body);
  assert.deepEqual(
    listing
      .json()
      .items.map((item) => item.id)
      .sort(),
    [...published.map((item) => item.id), ...assetIds].sort(),
  );
  for (const item of published) {
    const content = await app.inject({
      url: `${base}/artifacts/${item.id}/content`,
      headers: f.headers,
    });
    assert.equal(content.statusCode, 200);
    assert.equal(sha(content.rawPayload), sha(item.bytes));
  }
  const history = await app.inject({
    url: `${base}/asset/history?path=${encodeURIComponent('tools/setup.bin')}`,
    headers: f.headers,
  });
  assert.deepEqual(
    history.json().items.map((item) => [item.revision, item.sourceRevision ?? null]),
    [
      [3, 1],
      [2, null],
      [1, null],
    ],
  );
  // ACL survives as data; credentials of the source never authenticate again.
  for (const token of [credentials.session, credentials.pat, credentials.serviceKey])
    assert.equal(
      (await app.inject({ url: `${base}/artifacts`, headers: bearer(token) })).statusCode,
      401,
    );
  const fresh = await login(app);
  assert.equal(fresh.statusCode, 200, fresh.body);
  const readable = await app.inject({
    url: `${base}/artifacts`,
    headers: bearer(fresh.json().token),
  });
  assert.equal(readable.statusCode, 200, readable.body);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  database.release(() => pool.end());
  const upload = await pool.query('SELECT status, reclaimed FROM arkvory_uploads WHERE id=$1', [
    pending,
  ]);
  assert.deepEqual(upload.rows[0], { status: 'cancelled', reclaimed: true });
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM arkvory_user_sessions')).rows[0].n,
    1,
  );
  const again = await runBackup([...restoreArgs, '--yes'], target);
  assert.equal(again.code, 3);
  assert.equal(record(again, 'backup.failed').errorCode, 'target_not_empty');
  assert.ok((await readdir(storage)).includes('storage-id'));
});

/** A second, committed-looking point whose manifest names a file outside the point. */
async function craftPoint(vault, pointId) {
  const crafted = randomUUID();
  const target = join(vault, 'points', crafted);
  await cp(join(vault, 'points', pointId), target, { recursive: true });
  const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
  manifest.pointId = crafted;
  manifest.tables[0].file = '../../../outside.ndjson';
  const text = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(target, 'manifest.json'), text);
  const digest = createHash('sha256').update(text).digest('hex');
  await writeFile(
    join(target, 'COMMITTED'),
    JSON.stringify({ pointId: crafted, manifestSha256: digest }) + '\n',
  );
  return crafted;
}

test('vaults without vault.json, overlapping trees and crafted manifests are refused', async (t) => {
  const f = await setup(t);
  await publish(f);
  const env = sourceEnv(f);
  // An unmounted NAS share looks like an empty local directory: nothing may be written there.
  const mountPoint = await scratch(t, 'vault', 'mount');
  await mkdir(mountPoint);
  const missing = await runBackup(['capture', '--vault', mountPoint], env);
  assert.equal(missing.code, 3, missing.stdout);
  assert.equal(record(missing, 'backup.failed').errorCode, 'vault_missing');
  assert.deepEqual(await readdir(mountPoint), []);
  const inside = join(f.directory, 'vault');
  const init = await runBackup(['vault', 'init', inside], env);
  assert.equal(record(init, 'backup.failed').errorCode, 'unsafe_path');
  await assert.rejects(access(inside), { code: 'ENOENT' });
  await FileVault.initialize(inside, {
    vaultId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const alias = await scratch(t, 'alias', 'storage');
  await symlink(f.directory, alias, 'junction');
  try {
    for (const path of [inside, join(alias, 'vault')]) {
      const nested = await runBackup(['capture', '--vault', path], env);
      assert.equal(nested.code, 3, nested.stdout);
      assert.equal(record(nested, 'backup.failed').errorCode, 'unsafe_path');
    }
  } finally {
    // Removed while its target exists: only the link goes, never the storage behind it.
    await rm(alias, { recursive: true, force: true });
  }

  const { path: vault } = await newVault(t);
  const captured = await runBackup(['capture', '--vault', vault], env);
  assert.equal(captured.code, 0, captured.stdout);
  const pointId = record(captured, 'backup.capture.completed').pointId;
  const crafted = await craftPoint(vault, pointId);
  const one = await runBackup(['verify', '--vault', vault, '--point', crafted]);
  assert.equal(one.code, 4, one.stdout);
  assert.equal(record(one, 'backup.failed').errorCode, 'invalid_manifest');
  const all = await runBackup(['verify', '--vault', vault]);
  assert.equal(all.code, 4);
  const outcomes = Object.fromEntries(
    all.records.filter((r) => r.code === 'backup.verify.point').map((r) => [r.pointId, r.outcome]),
  );
  assert.deepEqual(outcomes, { [pointId]: 'verified', [crafted]: 'damaged' });
  const database = await temporaryDatabase(t);
  const storage = await scratch(t, 'restore', 'storage');
  const target = { ARKVORY_RESTORE_DATABASE_URL: database.url };
  const restore = (id, path = storage) =>
    runBackup(['restore', '--vault', vault, '--point', id, '--storage', path, '--yes'], target);
  assert.equal(record(await restore(crafted), 'backup.failed').errorCode, 'invalid_manifest');
  const nestedTarget = await restore(pointId, join(vault, 'restore'));
  assert.equal(nestedTarget.code, 3);
  assert.equal(record(nestedTarget, 'backup.failed').errorCode, 'unsafe_path');
  // A changed table file fails verification and restore before anything is written.
  await appendFile(join(vault, 'points', pointId, 'tables', 'arkvory_users.ndjson'), '{}\n');
  const damaged = await restore(pointId);
  assert.equal(damaged.code, 4, damaged.stdout);
  assert.equal(record(damaged, 'backup.failed').errorCode, 'integrity_mismatch');
  await assert.rejects(access(storage), { code: 'ENOENT' });
  const pool = new Pool({ connectionString: database.url, max: 1 });
  database.release(() => pool.end());
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'arkvory%'"))
      .rows[0].n,
    0,
  );
});

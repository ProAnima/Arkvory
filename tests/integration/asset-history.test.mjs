import test from 'node:test';
import assert from 'node:assert/strict';
import { DepotClient } from '@proanima/depot-sdk';
import { migrate } from '@proanima/depot-infrastructure';
import { setup, create, base } from './fixture.mjs';

const path = 'releases/файл & current.bin';
const encoded = encodeURIComponent(path);
async function publish(f, bytes) {
  const id = (await create(f, bytes)).json().id;
  const response = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(response.statusCode, 200, response.body);
  return id;
}
function assign(f, artifactId, expectedRevision) {
  return f.app.inject({
    method: 'PUT',
    url: `${base}/asset`,
    headers: f.headers,
    payload: { path, artifactId, expectedRevision },
  });
}
function restore(f, sourceRevision, expectedRevision, headers = f.headers) {
  return f.app.inject({
    method: 'POST',
    url: `${base}/asset/restore`,
    headers,
    payload: { path, sourceRevision, expectedRevision },
  });
}
function history(f, before) {
  return f.app.inject({
    url: `${base}/asset/history?path=${encoded}${before === undefined ? '' : `&before=${before}`}`,
    headers: f.readerHeaders,
  });
}

test('asset restore appends history, survives restart and keeps original bytes and legacy pointer', async (t) => {
  const f = await setup(t);
  const a = Buffer.from('original file'),
    b = Buffer.from('updated file');
  const first = await publish(f, a),
    second = await publish(f, b);
  assert.equal((await assign(f, first, 0)).json().revision, 1);
  assert.equal((await assign(f, second, 1)).json().revision, 2);
  const response = await restore(f, 1, 2);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { path, revision: 3, artifactId: first });
  assert.equal(
    (await restore(f, 1, 2)).statusCode,
    409,
    'lost response replay must not append again',
  );
  await f.restart();
  const page = (await history(f)).json();
  assert.equal(page.next, null);
  assert.deepEqual(
    page.items.map((r) => [r.revision, r.artifactId, r.sourceRevision]),
    [
      [3, first, 1],
      [2, second, null],
      [1, first, null],
    ],
  );
  for (const row of page.items) {
    assert.equal(row.actor, 'test-writer');
    assert(Number.isFinite(Date.parse(row.createdAt)));
  }
  for (const [id, bytes] of [
    [first, a],
    [second, b],
  ]) {
    const download = await f.app.inject({
      url: `${base}/artifacts/${id}/content`,
      headers: f.readerHeaders,
    });
    assert.deepEqual(download.rawPayload, bytes);
  }
  const legacy = await f.app.inject({
    url: `/endpoints/releases/content/${path.split('/').map(encodeURIComponent).join('/')}`,
    headers: f.readerHeaders,
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.deepEqual(legacy.rawPayload, a);
  const audit = (await f.app.inject({ url: `${base}/audit`, headers: f.headers })).json().items;
  assert.equal(audit.filter((r) => r.action === 'asset.restore').length, 1);
  assert.equal(audit.at(-1).artifactId, first);
});

test('history pagination is exclusive and stable across concurrent appends', async (t) => {
  const f = await setup(t);
  const id = await publish(f, Buffer.from('paged'));
  for (let expected = 0; expected < 101; expected++)
    assert.equal((await assign(f, id, expected)).statusCode, 200);
  const first = (await history(f)).json();
  assert.equal(first.items.length, 50);
  assert.equal(first.next, 52);
  assert.equal((await assign(f, id, 101)).statusCode, 200);
  const second = (await history(f, first.next)).json();
  assert.equal(second.items.length, 50);
  assert.equal(second.next, 2);
  const last = (await history(f, second.next)).json();
  assert.deepEqual(
    last.items.map((r) => r.revision),
    [1],
  );
  assert.equal(last.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...last.items].map((r) => r.revision),
    Array.from({ length: 101 }, (_, i) => 101 - i),
  );
  assert.deepEqual((await history(f, 1)).json(), { items: [], next: null });
  const exactPage = (await history(f, 51)).json();
  assert.equal(exactPage.items.length, 50);
  assert.equal(exactPage.next, null, 'no extra empty page');
});

test('competing restores commit one revision; history or audit failure rolls back the pointer', async (t) => {
  const f = await setup(t);
  const first = await publish(f, Buffer.from('old')),
    second = await publish(f, Buffer.from('new'));
  await assign(f, first, 0);
  await assign(f, second, 1);
  const results = await Promise.all([restore(f, 1, 2), restore(f, 1, 2)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  for (const table of ['depot_asset_revisions', 'depot_audit']) {
    await f.catalog.pool.query(
      `CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$; CREATE TRIGGER reject_change BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_change()`,
    );
    const response = await restore(f, 2, 3);
    assert.equal(response.statusCode, 503, response.body);
    const current = (
      await f.app.inject({ url: `${base}/asset?path=${encoded}`, headers: f.readerHeaders })
    ).json();
    assert.deepEqual(current, { path, revision: 3, artifactId: first });
    assert.equal((await history(f)).json().items.length, 3);
    await f.catalog.pool.query(
      `DROP TRIGGER reject_change ON ${table}; DROP FUNCTION reject_change()`,
    );
  }
  assert.equal((await restore(f, 2, 3)).json().revision, 4);
  const audit = (await f.app.inject({ url: `${base}/audit`, headers: f.headers })).json().items;
  assert.equal(audit.filter((r) => r.action === 'asset.restore').length, 2);
});

test('history and restoration validate revisions, permissions and repository/path boundaries', async (t) => {
  const f = await setup(t);
  const id = await publish(f, Buffer.from('private'));
  await assign(f, id, 0);
  assert.equal((await restore(f, 1, 1, f.readerHeaders)).statusCode, 403);
  assert.equal((await restore(f, 2, 1)).statusCode, 404);
  assert.equal((await restore(f, 1, 0)).statusCode, 400);
  for (const value of ['0', '-1', '1.5', '1e2', '01', '2147483648', 'Infinity', 'x']) {
    assert.equal((await history(f, value)).statusCode, 400, value);
    assert.equal(
      (
        await f.app.inject({
          url: `${base}/asset/revision?path=${encoded}&revision=${value}`,
          headers: f.readerHeaders,
        })
      ).statusCode,
      400,
      value,
    );
  }
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/asset/revision?path=${encoded}&revision=2147483647`,
        headers: f.readerHeaders,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/asset/history?path=../secret`, headers: f.readerHeaders }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/asset/history?path=missing`, headers: f.readerHeaders }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/asset/revision?path=missing&revision=1`,
        headers: f.readerHeaders,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base.replace('releases', 'other')}/asset/history?path=${encoded}`,
        headers: f.headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/asset/history?path=${encoded}` })).statusCode,
    401,
  );
  const writeOnly = {
    ...f.config.keys[0],
    principal: { ...f.config.keys[0].principal, permissions: ['write'] },
  };
  f.config.keys[0] = writeOnly;
  await f.restart();
  assert.equal((await restore(f, 1, 1)).statusCode, 403);
});

test('asset revisions cannot cross repositories or overflow the database integer', async (t) => {
  const f = await setup(t);
  const id = await publish(f, Buffer.from('scoped history'));
  await assign(f, id, 0);
  f.config.keys[0] = {
    ...f.config.keys[0],
    principal: { ...f.config.keys[0].principal, repositories: ['releases', 'other'] },
  };
  await f.restart();
  const otherBase = base.replace('releases', 'other');
  for (const suffix of [
    `asset/history?path=${encoded}`,
    `asset/revision?path=${encoded}&revision=1`,
  ]) {
    assert.equal(
      (await f.app.inject({ url: `${otherBase}/${suffix}`, headers: f.headers })).statusCode,
      404,
    );
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${otherBase}/asset/restore`,
        headers: f.headers,
        payload: { path, sourceRevision: 1, expectedRevision: 1 },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${otherBase}/asset`,
        headers: f.headers,
        payload: { path, artifactId: id, expectedRevision: 0 },
      })
    ).statusCode,
    404,
  );
  await f.catalog.pool.query(
    'UPDATE depot_asset_revisions SET revision=2147483646 WHERE repository=$1 AND path=$2; ',
    ['releases', path],
  );
  await f.catalog.pool.query(
    'UPDATE depot_assets SET revision=2147483646 WHERE repository=$1 AND path=$2',
    ['releases', path],
  );
  const response = await restore(f, 2147483646, 2147483646);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().revision, 2147483647);
  assert.equal((await history(f)).json().items[0].revision, 2147483647);
  assert.equal((await restore(f, 2147483646, 2147483647)).statusCode, 400);
  assert.equal((await assign(f, id, 2147483647)).statusCode, 400);
});

test('migration preserves old asset history without inventing authors or timestamps', async (t) => {
  const f = await setup(t);
  const id = await publish(f, Buffer.from('before migration'));
  await assign(f, id, 0);
  await f.app.close();
  await f.catalog.pool.query(
    `ALTER TABLE depot_asset_revisions DROP COLUMN actor, DROP COLUMN created_at, DROP COLUMN source_revision;
     ALTER TABLE depot_asset_revisions DROP CONSTRAINT depot_asset_revision_positive;
     DROP TABLE depot_gateway_leases, depot_download_policy;
     DROP TABLE depot_user_sessions, depot_group_members, depot_group_grants,
                depot_users, depot_access_groups;
     DROP FUNCTION depot_semver_key(text) CASCADE;
     ALTER TABLE depot_jobs DROP COLUMN credential_id;
     DROP TABLE depot_service_delegations, depot_service_audit, depot_api_keys, depot_service_accounts;
     DELETE FROM depot_migrations WHERE version>=4`,
  );
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
  await migrate(f.catalog.pool);
  await migrate(f.catalog.pool);
  await f.restart();
  const old = (await history(f)).json().items[0];
  assert.equal(old.actor, null);
  assert.equal(old.createdAt, null);
  assert.equal(old.sourceRevision, null);
  assert.equal((await restore(f, 1, 1)).statusCode, 200);
  assert.equal((await history(f)).json().items[0].actor, 'test-writer');
});

test('SDK resolves and restores history over HTTP and streams an old revision range', async (t) => {
  const f = await setup(t);
  const first = await publish(f, Buffer.from('old content')),
    second = await publish(f, Buffer.from('new content'));
  const client = new DepotClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.deepEqual(await client.setAsset('releases', path, first, 0), {
    path,
    artifactId: first,
    revision: 1,
  });
  await client.setAsset('releases', path, second, 1);
  const old = await client.assetRevision('releases', path, 1);
  const response = await client.download('releases', old.artifactId, { start: 0, end: 2 });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'old');
  assert.equal((await client.restoreAsset('releases', path, 1, 2)).revision, 3);
  assert.equal((await client.assetHistory('releases', path)).items[0].sourceRevision, 1);
  assert.deepEqual(
    (await client.assetHistory('releases', path, 2)).items.map((r) => r.revision),
    [1],
  );
  await assert.rejects(client.restoreAsset('releases', path, 1, 2), { status: 409 });
  await assert.rejects(client.assetHistory('releases', path, undefined, AbortSignal.abort()), {
    name: 'AbortError',
  });
});

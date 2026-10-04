import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { migrate } from '@proanima/arkvory-infrastructure';
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
  const current = await f.app.inject({
    url: `${base}/asset/content?path=${encodeURIComponent(path)}`,
    headers: f.readerHeaders,
  });
  assert.equal(current.statusCode, 200, current.body);
  assert.deepEqual(current.rawPayload, a);
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
  for (const table of ['arkvory_asset_revisions', 'arkvory_audit']) {
    await f.catalog.pool.query(
      `CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$; CREATE TRIGGER reject_change BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_change()`,
    );
    const response = await restore(f, 2, 3);
    // A trigger exception is an unclassified database failure: 500 internal, no Retry-After.
    assert.equal(response.statusCode, 500, response.body);
    assert.equal(response.headers['retry-after'], undefined);
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
    'UPDATE arkvory_asset_revisions SET revision=2147483646 WHERE repository=$1 AND path=$2; ',
    ['releases', path],
  );
  await f.catalog.pool.query(
    'UPDATE arkvory_assets SET revision=2147483646 WHERE repository=$1 AND path=$2',
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
    `DROP TABLE arkvory_npm_tags, arkvory_npm_versions;
     DROP TABLE arkvory_lfs_locks, arkvory_lfs_objects;
     DROP TABLE arkvory_oci_uploads, arkvory_oci_references, arkvory_oci_tags,
       arkvory_oci_manifests, arkvory_oci_blobs;
     DROP TABLE arkvory_transfer_links;
     DROP TABLE arkvory_mirror_state;
     ALTER TABLE arkvory_audit DROP COLUMN detail;
     DROP TABLE arkvory_backup_requests, arkvory_backup_points, arkvory_backup_plan,
       arkvory_backup_agent;
     DROP TABLE arkvory_backup_pins, arkvory_backup_barrier, arkvory_backup_jobs;
     DROP TABLE arkvory_security_audit;
     DROP FUNCTION arkvory_security_audit_append_only();
     ALTER TABLE arkvory_asset_revisions DROP COLUMN actor, DROP COLUMN created_at, DROP COLUMN source_revision;
     ALTER TABLE arkvory_asset_revisions DROP CONSTRAINT arkvory_asset_revision_positive;
     DROP TABLE arkvory_promotions, arkvory_promotion_events, arkvory_artifact_stages;
     DROP TABLE arkvory_gateway_leases, arkvory_download_policy;
     DROP TABLE arkvory_user_tokens;
     ALTER TABLE arkvory_uploads DROP COLUMN storage_backend, DROP COLUMN part_bytes;
     DROP TABLE arkvory_user_sessions, arkvory_group_members, arkvory_group_grants,
                arkvory_users, arkvory_access_groups;
     DROP FUNCTION arkvory_semver_key(text) CASCADE;
     ALTER TABLE arkvory_jobs DROP COLUMN credential_id;
     DROP TABLE arkvory_storage_policies, arkvory_storage_events;
     DROP TABLE arkvory_cleanup_settings;
     ALTER TABLE arkvory_uploads DROP COLUMN temp_cleaned, DROP COLUMN gc_checked_at;
     DROP TABLE arkvory_service_delegations, arkvory_service_audit, arkvory_api_keys, arkvory_service_accounts;
     DROP TABLE arkvory_attachment_targets, arkvory_attachment_revisions;
     DROP TABLE arkvory_artifact_deletions;
     DROP TRIGGER arkvory_record_publication ON arkvory_uploads;
     DROP FUNCTION arkvory_record_publication();
     ALTER TABLE arkvory_uploads DROP COLUMN published_at;
     DROP INDEX arkvory_asset_history_artifact, arkvory_asset_current_artifact;
     DELETE FROM arkvory_migrations WHERE version>=4`,
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
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
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

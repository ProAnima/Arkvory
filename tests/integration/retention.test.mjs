import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DepotClient } from '@proanima/depot-sdk';
import {
  PostgresRetention,
  PostgresBrowse,
  LocalBlobStore,
  PostgresCatalog,
  PostgresCleanup,
} from '@proanima/depot-infrastructure';
import { GarbageCollector } from '@proanima/depot-application';
import { setup, create, base } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
const path = '/api/v1/repositories/{repository}';
async function publish(f) {
  const bytes = Buffer.from(randomUUID()),
    made = await create(f, bytes),
    id = made.json().id;
  const done = await f.app.inject({
    method: 'PUT',
    url: base + '/uploads/' + id + '/content',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  return id;
}
async function cleaner(f) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new DepotClient(await f.listen(), () => f.headers.authorization.slice(7));
  const bindings = [
    { resource: { kind: 'repository', id: 'releases' }, actions: ['artifact.delete'] },
  ];
  const account = await root.createServiceAccount('cleaner', bindings);
  const key = await root.issueServiceKey(account.id, 'issue-cleaner', {
    name: 'cleaner',
    bindings,
  });
  const client = new DepotClient(rootUrl(f), () => key.secret);
  await client.activateServiceKey();
  return {
    root,
    client,
    headers: { authorization: 'Bearer ' + key.secret },
    key,
    principal: {
      id: 'service:' + account.id,
      repositories: [],
      permissions: [],
      managed: { accountId: account.id, keyId: key.key.id, bindings },
    },
  };
}
function rootUrl(f) {
  const address = f.app.server.address();
  return 'http://127.0.0.1:' + address.port;
}
const criteria = () => ({ publishedBefore: new Date().toISOString(), protectedLabels: [] });
const selection = (id, revision = 0) => ({ id, expectedAnnotationRevision: revision });

test('deletion is explicitly scoped, idempotent, persistent, and does not unlink active content', async (t) => {
  const f = await setup(t),
    id = await publish(f),
    c = await cleaner(f);
  for (const headers of [f.headers, f.readerHeaders]) {
    const denied = await f.app.inject({
      method: 'DELETE',
      url: base + '/artifacts/' + id,
      headers,
      payload: { expectedAnnotationRevision: 0 },
    });
    assert.equal(denied.statusCode, 403);
    validateResponse(path + '/artifacts/{id}', 'delete', denied);
  }
  await assert.rejects(c.client.inspectDeletion('private', id), { status: 403 });
  await assert.rejects(c.client.download('releases', id), { status: 403 });
  const candidate = await c.client.inRepository('releases').artifacts.inspectDeletion(id);
  assert.equal(candidate.annotationRevision, 0);
  assert.deepEqual(candidate.blockers, []);
  const deleted = await c.client.inRepository('releases').artifacts.delete(id, 0);
  assert.equal(deleted.outcome, 'deleted');
  assert.equal((await c.client.deleteArtifact('releases', id, 0)).outcome, 'already_deleted');
  assert.equal(
    (await f.app.inject({ url: base + '/artifacts/' + id + '/content', headers: f.headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ url: base + '/artifacts', headers: f.headers })).json().items.length,
    0,
  );
  const blobs = new LocalBlobStore(f.directory);
  // The HTTP operation must not remove bytes; GC is a distinct fenced maintenance task.
  await blobs.exists(id, 36);
  assert.equal(
    (await f.catalog.pool.query("SELECT count(*) FROM depot_audit WHERE action='artifact.delete'"))
      .rows[0].count,
    '1',
  );
  await f.restart();
  const replay = await f.app.inject({
    method: 'DELETE',
    url: base + '/artifacts/' + id,
    headers: c.headers,
    payload: { expectedAnnotationRevision: 0 },
  });
  assert.equal(replay.json().outcome, 'already_deleted');
  validateResponse(path + '/artifacts/{id}', 'delete', replay);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: base + '/uploads/' + id + '/complete',
        headers: f.headers,
      })
    ).statusCode,
    409,
  );
  const maintenance = new PostgresCatalog(f.config.databaseUrl, f.config.capacityBytes, 1);
  try {
    await assert.rejects(maintenance.claimStorage(await blobs.identity(), 'maintenance'), {
      code: 'busy',
    });
    await f.app.close();
    await maintenance.claimStorage(await blobs.identity(), 'maintenance');
    const gc = new GarbageCollector(new PostgresCleanup(maintenance.pool), blobs);
    await gc.run(new Date().toISOString());
    await blobs.exists(id, 36);
    assert.equal(
      (await f.catalog.pool.query('SELECT reclaimed FROM depot_uploads WHERE id=$1', [id])).rows[0]
        .reclaimed,
      false,
    );
    await gc.run(new Date(Date.now() + 2 * 86400000).toISOString());
    await assert.rejects(blobs.exists(id, 36), { code: 'unavailable' });
    assert.equal(
      (await f.catalog.pool.query('SELECT reclaimed FROM depot_uploads WHERE id=$1', [id])).rows[0]
        .reclaimed,
      true,
    );
    assert.equal(
      (
        await f.catalog.pool.query(
          'SELECT count(*) FROM depot_artifact_deletions WHERE artifact_id=$1',
          [id],
        )
      ).rows[0].count,
      '1',
    );
  } finally {
    await maintenance.close();
  }
});

test('retention rechecks changed annotations, protected labels, reference and historical pins', async (t) => {
  const f = await setup(t),
    ids = await Promise.all(Array.from({ length: 5 }, () => publish(f)));
  const c = await cleaner(f),
    repo = c.client.inRepository('releases'),
    before = criteria();
  const preview = await repo.retention.preview({ criteria: before, limit: 2 });
  assert.equal(preview.items.length, 2);
  assert.ok(preview.next);
  const rest = await repo.retention.preview({ criteria: before, after: preview.next, limit: 100 });
  assert.equal(new Set([...preview.items, ...rest.items].map((x) => x.id)).size, 5);
  const labelled = await repo.retention.preview({
    criteria: { ...before, protectedLabels: ['release'] },
  });
  assert.ok(labelled.items.every((x) => x.blockers.includes('protected_label')));
  const [changed, referenced, asset, attached, parent] = ids;
  await c.root.annotate('releases', changed, 0, {
    labels: ['release'],
    metadata: { stage: 'prod' },
    collections: [],
  });
  const ref = await f.app.inject({
    method: 'POST',
    url: base + '/artifacts/' + referenced + '/references',
    headers: f.headers,
    payload: { key: 'deployment-1' },
  });
  assert.equal(ref.statusCode, 204, ref.body);
  await c.root.setAsset('releases', 'archive.bin', asset, 0);
  await c.root.setAsset('releases', 'archive.bin', parent, 1);
  await c.root.replaceAttachments('releases', parent, 0, [
    { name: 'manifest.json', kind: 'manifest', artifactId: attached, description: '' },
  ]);
  await c.root.replaceAttachments('releases', parent, 1, []);
  const applied = await repo.retention.apply({
    criteria: before,
    items: ids.map((id) => selection(id)),
  });
  assert.deepEqual(
    applied.items.map((x) => x.outcome),
    ['changed', 'protected', 'protected', 'protected', 'protected'],
  );
  assert.deepEqual(applied.items[1].blockers, ['reference']);
  assert.deepEqual(applied.items[2].blockers, ['asset_history']);
  assert.deepEqual(applied.items[3].blockers, ['attachment_history']);
  const protectedResult = await repo.retention.apply({
    criteria: { ...before, protectedLabels: ['release'] },
    items: [selection(changed, 1)],
  });
  assert.deepEqual(protectedResult.items[0].blockers, ['protected_label']);
  const late = await publish(f);
  assert.equal(
    (await repo.retention.apply({ criteria: before, items: [selection(late)] })).items[0].outcome,
    'not_eligible',
  );
});

test('retirement preserves package identity and makes latest resolve the remaining published version', async (t) => {
  const f = await setup(t),
    old = await publish(f),
    newest = await publish(f),
    replacement = await publish(f),
    c = await cleaner(f),
    browse = new PostgresBrowse(f.catalog.pool);
  // Register through the adapter: archive parsing is independently covered by publication tests.
  for (const [id, version] of [
    [old, '1.0.0'],
    [newest, '2.0.0'],
  ])
    await browse.register(
      'releases',
      id,
      { group: '', name: 'app', version, original: { name: 'app', version } },
      'test-writer',
    );
  assert.equal(await browse.resolvePackage('releases', '', 'app', undefined), newest);
  assert.equal((await c.client.deleteArtifact('releases', newest, 0)).outcome, 'deleted');
  assert.equal(await browse.resolvePackage('releases', '', 'app', undefined), old);
  assert.equal(await browse.resolvePackage('releases', '', 'app', '2.0.0'), null);
  assert.deepEqual(
    (await c.root.packages('releases')).items.map((x) => x.artifactId),
    [old],
  );
  await assert.rejects(
    browse.register(
      'releases',
      replacement,
      { group: '', name: 'app', version: '2.0.0', original: { name: 'app', version: '2.0.0' } },
      'test-writer',
    ),
    { code: 'conflict' },
  );
});

test('delete and pin races cannot commit dangling references; revoked credentials and audit failures roll back', async (t) => {
  const f = await setup(t),
    c = await cleaner(f),
    browse = new PostgresBrowse(f.catalog.pool);
  for (let i = 0; i < 8; i++) {
    const id = await publish(f);
    const outcomes = await Promise.allSettled([
      c.client.deleteArtifact('releases', id, 0),
      browse.reference('releases', id, 'test-writer', undefined, 'race', false),
    ]);
    assert.equal(outcomes[0].status, 'fulfilled');
    const retired = outcomes[0].value.outcome === 'deleted';
    assert.equal(outcomes[1].status, retired ? 'rejected' : 'fulfilled');
    if (retired) assert.equal(outcomes[1].reason.code, 'not_found');
    assert.equal(
      (
        await f.catalog.pool.query('SELECT count(*) FROM depot_references WHERE artifact_id=$1', [
          id,
        ])
      ).rows[0].count,
      retired ? '0' : '1',
    );
  }
  const first = await publish(f),
    second = await publish(f);
  await f.catalog.pool
    .query(`CREATE FUNCTION reject_delete_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='artifact.delete' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_delete_audit BEFORE INSERT ON depot_audit FOR EACH ROW EXECUTE FUNCTION reject_delete_audit()`);
  await assert.rejects(
    c.client.applyRetention('releases', {
      criteria: criteria(),
      items: [selection(first), selection(second)],
    }),
    { status: 503 },
  );
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT count(*) FROM depot_uploads WHERE id=ANY($1::uuid[]) AND status='available'",
        [[first, second]],
      )
    ).rows[0].count,
    '2',
  );
  assert.equal(
    (
      await f.catalog.pool.query(
        'SELECT count(*) FROM depot_artifact_deletions WHERE artifact_id=ANY($1::uuid[])',
        [[first, second]],
      )
    ).rows[0].count,
    '0',
  );
  await c.root.revokeServiceKey(c.key.key.id);
  await assert.rejects(
    new PostgresRetention(f.catalog.pool).remove(
      { principal: c.principal, repository: 'releases', actions: ['artifact.delete'] },
      [selection(first)],
    ),
    { code: 'forbidden' },
  );
});

test('retention bounds, malformed filters, schema responses and operation visibility', async (t) => {
  const f = await setup(t),
    id = await publish(f),
    c = await cleaner(f);
  for (const payload of [
    {},
    { criteria: { publishedBefore: new Date().toISOString() } },
    { criteria: { ...criteria(), publishedBefore: '2999-01-01T00:00:00.000Z' } },
    { criteria: criteria(), limit: 101 },
    { criteria: criteria(), after: 'oops' },
    { criteria: criteria(), unknown: true },
  ]) {
    const r = await f.app.inject({
      method: 'POST',
      url: base + '/retention/preview',
      headers: c.headers,
      payload,
    });
    assert.equal(r.statusCode, 400, r.body);
    validateResponse(path + '/retention/preview', 'post', r);
  }
  for (const selected of [
    [],
    [selection(id), selection(id)],
    Array.from({ length: 101 }, () => selection(randomUUID())),
    [selection(id, -1)],
  ]) {
    const r = await f.app.inject({
      method: 'POST',
      url: base + '/retention/apply',
      headers: c.headers,
      payload: { criteria: criteria(), items: selected },
    });
    assert.equal(r.statusCode, 400, r.body);
  }
  for (const [url, method, payload, schema] of [
    [base + '/artifacts/' + id + '/deletion', 'GET', undefined, path + '/artifacts/{id}/deletion'],
    [base + '/retention/preview', 'POST', { criteria: criteria() }, path + '/retention/preview'],
    [
      base + '/retention/apply',
      'POST',
      { criteria: criteria(), items: [selection(id)] },
      path + '/retention/apply',
    ],
  ]) {
    const r = await f.app.inject({
      url,
      method,
      headers: c.headers,
      ...(payload ? { payload } : {}),
    });
    assert.equal(r.statusCode, 200, r.body);
    validateResponse(schema, method.toLowerCase(), r);
  }
  const managed = (await c.client.operations({ repository: 'releases', limit: 100 })).items;
  assert.ok(managed.some((x) => x.operationId === 'deleteArtifact'));
  const legacy = (await c.root.operations({ repository: 'releases', limit: 100 })).items;
  assert.ok(!legacy.some((x) => x.operationId === 'deleteArtifact'));
  await f.catalog.pool.query('DELETE FROM depot_migrations WHERE version=13');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
});

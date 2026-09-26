import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { PostgresAttachments } from '@proanima/arkvory-infrastructure';
import { setup, create, base, descriptor } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
const path = '/api/v1/repositories/{repository}/artifacts/{id}/attachments';
async function publish(f, data = Buffer.from(randomUUID()), repo = 'releases') {
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repo}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: descriptor(data),
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const done = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repo}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: data,
  });
  assert.equal(done.statusCode, 200, done.body);
  return id;
}
const item = (artifactId, name = 'build.json') => ({
  name,
  artifactId,
  kind: 'manifest',
  description: 'CI build metadata',
});

test('attachments preserve immutable bytes, CAS history and reference integrity across restart', async (t) => {
  const f = await setup(t),
    build = await publish(f),
    bytes = Buffer.from('{"build":42}'),
    target = await publish(f, bytes);
  const url = `${base}/artifacts/${build}/attachments`;
  const empty = await f.app.inject({ url, headers: f.headers });
  validateResponse(path, 'get', empty);
  assert.equal(empty.json().revision, 0);
  const payload = { expectedRevision: 0, items: [item(target)] };
  const saved = await f.app.inject({ method: 'PUT', url, headers: f.headers, payload });
  validateResponse(path, 'put', saved);
  assert.equal(saved.statusCode, 200, saved.body);
  const races = await Promise.all(
    [0, 1].map(() =>
      f.app.inject({
        method: 'PUT',
        url,
        headers: f.headers,
        payload: { ...payload, expectedRevision: 1 },
      }),
    ),
  );
  assert.deepEqual(races.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (await f.app.inject({ method: 'PUT', url, headers: f.headers, payload })).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url,
        headers: f.readerHeaders,
        payload: { ...payload, expectedRevision: 2 },
      })
    ).statusCode,
    403,
  );
  const removed = await f.app.inject({
    method: 'PUT',
    url,
    headers: f.headers,
    payload: { expectedRevision: 2, items: [] },
  });
  assert.equal(removed.json().revision, 3);
  await f.restart();
  const history = await f.app.inject({ url: url + '/history', headers: f.readerHeaders });
  validateResponse(path + '/history', 'get', history);
  assert.deepEqual(
    history.json().items.map((r) => r.revision),
    [3, 2, 1],
  );
  assert.equal(history.json().items[2].items[0].artifactId, target);
  assert.equal(history.json().items[2].actor, 'test-writer');
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${target}/content`, headers: f.readerHeaders }))
      .body,
    bytes.toString(),
  );
  // Historical targets remain foreign-key protected even after unlinking.
  await assert.rejects(f.catalog.pool.query('DELETE FROM depot_uploads WHERE id=$1', [target]), {
    code: '23503',
  });
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT count(*) FROM depot_audit WHERE action='attachments.replace'",
      )
    ).rows[0].count,
    '3',
  );
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7)),
    repo = client.inRepository('releases');
  await repo.attachments.replace(build, 3, history.json().items[2].items);
  assert.equal((await repo.attachments.get(build)).revision, 4);
});

test('attachment targets must be published in the exact repository, with bounded validated requests', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.repositories.push('private');
  const build = await publish(f),
    target = await publish(f),
    other = await publish(f, undefined, 'private'),
    pending = (await create(f, Buffer.from('pending'))).json().id;
  const url = `${base}/artifacts/${build}/attachments`;
  for (const targetId of [randomUUID(), other, pending]) {
    const r = await f.app.inject({
      method: 'PUT',
      url,
      headers: f.headers,
      payload: { expectedRevision: 0, items: [item(targetId)] },
    });
    assert.equal(r.statusCode, 404, r.body);
    validateResponse(path, 'put', r);
  }
  for (const payload of [
    { expectedRevision: 0, items: [item(build)] },
    { expectedRevision: -1, items: [] },
    { expectedRevision: 0, items: [item(target), item(target, 'BUILD.json')] },
    { expectedRevision: 0, items: Array(33).fill(item(target)) },
    { expectedRevision: 0, items: [{ ...item(target), unexpected: 1 }] },
    { expectedRevision: 0, items: [], extra: 1 },
  ])
    assert.equal(
      (await f.app.inject({ method: 'PUT', url, headers: f.headers, payload })).statusCode,
      400,
    );
  for (const query of [
    'before=0',
    'before=2147483648',
    'before=1&before=2',
    'before=no',
    'extra=1',
  ])
    assert.equal(
      (await f.app.inject({ url: url + '/history?' + query, headers: f.headers })).statusCode,
      400,
    );
  assert.equal(
    (await f.app.inject({ url: url.replace('/releases/', '/private/'), headers: f.readerHeaders }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/artifacts/${randomUUID()}/attachments`,
        headers: f.headers,
      })
    ).statusCode,
    404,
  );
  const address = await f.listen(),
    head = await fetch(address + url, { method: 'HEAD', headers: f.headers });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('cache-control'), /no-store/);
});

test('attachment SDK paginates history without loss and handles revoked managed writes at transaction commit', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.serviceAdministrator = true;
  const build = await publish(f),
    target = await publish(f),
    address = await f.listen(),
    root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: ['annotation.read', 'annotation.write', 'artifact.read'],
    },
  ];
  const account = await root.createServiceAccount('build-editor', bindings),
    issued = await root.issueServiceKey(account.id, 'create-build-editor', {
      name: 'build-editor',
      bindings,
    });
  const client = new ArkvoryClient(address, () => issued.secret);
  await client.activateServiceKey();
  for (let revision = 0; revision < 23; revision++)
    await client.replaceAttachments(
      'releases',
      build,
      revision,
      revision % 2 ? [item(target)] : [],
    );
  const first = await client.attachmentHistory('releases', build);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, 4);
  const second = await client.attachmentHistory('releases', build, first.next);
  assert.deepEqual(
    second.items.map((i) => i.revision),
    [3, 2, 1],
  );
  assert.equal(second.next, null);
  await assert.rejects(client.download('releases', target), { status: 403 });
  // Capture a principal before revocation to exercise the adapter's transaction-time check.
  const principal = {
    id: `service:${account.id}`,
    repositories: [],
    permissions: [],
    managed: { accountId: account.id, keyId: issued.key.id, bindings },
  };
  await root.revokeServiceKey(issued.key.id);
  const store = new PostgresAttachments(f.catalog.pool);
  await assert.rejects(
    store.replace('releases', build, 23, [item(target)], {
      principal,
      repository: 'releases',
      actions: ['annotation.write', 'artifact.read'],
    }),
    { code: 'forbidden' },
  );
  assert.equal((await root.attachments('releases', build)).revision, 23);
  await assert.rejects(client.attachments('releases', build), { status: 401 });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(root.attachments('releases', build, aborted.signal));
});

test('attachment history, target pins and audit roll back together; migration 12 gates readiness', async (t) => {
  const f = await setup(t),
    build = await publish(f),
    target = await publish(f);
  const url = `${base}/artifacts/${build}/attachments`;
  await f.catalog.pool
    .query(`CREATE FUNCTION reject_attachment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
    CREATE TRIGGER reject_attachment_audit BEFORE INSERT ON depot_audit FOR EACH ROW EXECUTE FUNCTION reject_attachment_audit()`);
  const response = await f.app.inject({
    method: 'PUT',
    url,
    headers: f.headers,
    payload: { expectedRevision: 0, items: [item(target)] },
  });
  assert.equal(response.statusCode, 503);
  assert.equal((await f.app.inject({ url, headers: f.headers })).json().revision, 0);
  assert.equal(
    (await f.catalog.pool.query('SELECT count(*) FROM depot_attachment_targets')).rows[0].count,
    '0',
  );
  await f.catalog.pool.query(
    'DROP TRIGGER reject_attachment_audit ON depot_audit; DROP FUNCTION reject_attachment_audit()',
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url,
        headers: f.headers,
        payload: { expectedRevision: 0, items: [item(target)] },
      })
    ).statusCode,
    200,
  );
  await f.catalog.pool.query('DELETE FROM depot_migrations WHERE version=12');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
});

test('independent builds can link each other concurrently without recursively resolving attachments', async (t) => {
  const f = await setup(t),
    left = await publish(f),
    right = await publish(f);
  const responses = await Promise.all(
    [
      [left, right],
      [right, left],
    ].map(([parent, target]) =>
      f.app.inject({
        method: 'PUT',
        url: `${base}/artifacts/${parent}/attachments`,
        headers: f.headers,
        payload: { expectedRevision: 0, items: [item(target)] },
      }),
    ),
  );
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    (
      await f.app.inject({ url: `${base}/artifacts/${left}/attachments`, headers: f.headers })
    ).json().items[0].artifactId,
    right,
  );
  assert.equal(
    (
      await f.app.inject({ url: `${base}/artifacts/${right}/attachments`, headers: f.headers })
    ).json().items[0].artifactId,
    left,
  );
});

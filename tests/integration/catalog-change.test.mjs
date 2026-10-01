import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, create, base } from './fixture.mjs';

const binding = (actions) => [{ resource: { kind: 'repository', id: 'releases' }, actions }];
const rejectInsert = (table, action) =>
  `CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER reject_change BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_change()`;
const allowInsert = (table) =>
  `DROP TRIGGER reject_change ON ${table}; DROP FUNCTION reject_change()`;

async function publish(f) {
  const bytes = Buffer.from('catalog change');
  const id = (await create(f, bytes)).json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

test('annotation and reference changes commit only together with their catalog audit row', async (t) => {
  const f = await setup(t);
  const id = await publish(f);
  const annotate = (expectedRevision) =>
    f.app.inject({
      method: 'PUT',
      url: `${base}/artifacts/${id}/annotations`,
      headers: f.headers,
      payload: { expectedRevision, value: { labels: ['ci'], metadata: {}, collections: [] } },
    });
  const reference = () =>
    f.app.inject({
      method: 'POST',
      url: `${base}/artifacts/${id}/references`,
      headers: f.headers,
      payload: { key: 'deploy:prod' },
    });
  const references = async () =>
    (await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_references')).rows[0].n;
  for (const [action, change] of [
    ['annotations.replace', () => annotate(0)],
    ['reference.add', reference],
  ]) {
    await f.catalog.pool.query(rejectInsert('arkvory_audit', action));
    assert.equal((await change()).statusCode, 500);
    await f.catalog.pool.query(allowInsert('arkvory_audit'));
  }
  const current = await f.app.inject({
    url: `${base}/artifacts/${id}/annotations`,
    headers: f.headers,
  });
  assert.equal(current.json().revision, 0);
  assert.equal(await references(), 0);
  assert.equal((await annotate(0)).json().revision, 1);
  // A lost compare-and-set rolls back before the audit row is written.
  assert.equal((await annotate(0)).statusCode, 409);
  assert.equal((await reference()).statusCode, 204);
  assert.equal((await reference()).statusCode, 204);
  assert.equal(await references(), 1);
  const audit = (await f.app.inject({ url: `${base}/audit`, headers: f.headers })).json().items;
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ['annotations.replace', 'reference.add', 'reference.add'],
  );
});

test('service key issue and activation roll back when the service audit cannot be written', async (t) => {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) });
  f.config.keys[0].principal.serviceAdministrator = true;
  const address = await f.listen();
  const root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const grants = binding(['artifact.list']);
  const account = await root.createServiceAccount('audited-reader', grants);
  const keys = async () =>
    (
      await f.catalog.pool.query('SELECT state FROM arkvory_api_keys WHERE account_id=$1', [
        account.id,
      ])
    ).rows.map((row) => row.state);
  await f.catalog.pool.query(rejectInsert('arkvory_service_audit', 'key.issue'));
  await assert.rejects(
    root.issueServiceKey(account.id, 'audited', { name: 'primary', bindings: grants }),
    { status: 500 },
  );
  await f.catalog.pool.query(allowInsert('arkvory_service_audit'));
  assert.deepEqual(await keys(), []);
  // The failed attempt left no idempotency record, so the retry issues a new secret.
  const issued = await root.issueServiceKey(account.id, 'audited', {
    name: 'primary',
    bindings: grants,
  });
  assert.match(issued.secret, /^arkvory_/);
  const service = new ArkvoryClient(address, () => issued.secret);
  await f.catalog.pool.query(rejectInsert('arkvory_service_audit', 'key.activate'));
  await assert.rejects(service.activateServiceKey(), { status: 500 });
  await f.catalog.pool.query(allowInsert('arkvory_service_audit'));
  assert.deepEqual(await keys(), ['pending']);
  await service.activateServiceKey();
  assert.deepEqual(await keys(), ['active']);
});

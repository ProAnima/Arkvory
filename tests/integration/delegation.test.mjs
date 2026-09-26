import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { ServiceAccess } from '@proanima/arkvory-application';
import { PostgresServices } from '@proanima/arkvory-infrastructure';
import { administrationActions } from '@proanima/arkvory-domain';
import { validateResponse } from '../api-schema.mjs';
import { setup } from './fixture.mjs';
const binding = (actions, id = 'releases') => [{ resource: { kind: 'repository', id }, actions }];
const read = binding(['content.read']);
async function fixture(t) {
  const f = await setup(t);
  f.config.keys[0].principal.serviceAdministrator = true;
  const address = await f.listen();
  const root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const operator = await root.createServiceAccount('operator', []);
  const operatorKey = await root.issueServiceKey(operator.id, randomUUID(), {
    name: 'operator-key',
    bindings: [],
  });
  const client = new ArkvoryClient(address, () => operatorKey.secret);
  await client.activateServiceKey();
  const target = await root.createServiceAccount('consumer', read);
  const grant = (
    actions = administrationActions,
    ceiling = read,
    revision = 0,
    accountId = target.id,
    keyId = operatorKey.key.id,
  ) => root.setServiceDelegation(keyId, accountId, revision, actions, ceiling);
  return { ...f, root, address, operator, operatorKey, client, target, grant };
}
const issue = (client, id, bindings = read, extra = {}) =>
  client.issueServiceKey(id, randomUUID(), { name: 'consumer-key', bindings, ...extra });
const activate = (f, key) => new ArkvoryClient(f.address, () => key.secret).activateServiceKey();

test('bootstrap delegates an exact target; SDK lifecycle respects actions, discovery, isolation and audit', async (t) => {
  const f = await fixture(t);
  await f.grant();
  assert.equal((await f.client.capabilities()).features.delegatedServiceAdministration, true);
  assert.equal((await f.client.permissions()).credentialId, f.operatorKey.key.id);
  assert.equal((await f.client.permissions()).serviceAdministration, false);
  assert.deepEqual(
    (await f.client.serviceAccounts()).items.map((a) => a.id),
    [f.target.id],
  );
  assert.equal((await f.client.servicePolicy(f.target.id)).id, f.target.id);
  assert.equal(
    (await f.client.serviceDelegations(f.operatorKey.key.id))[0].targetAccountId,
    f.target.id,
  );
  const outsider = await f.root.createServiceAccount('outside', read);
  await assert.rejects(f.client.serviceAccount(outsider.id), { status: 404 });
  const foreign = await issue(f.root, outsider.id);
  await assert.rejects(f.client.serviceKey(foreign.key.id), { status: 404 });
  for (const path of ['', '/revoke', '/rotate']) {
    const errors = [];
    for (const id of [foreign.key.id, randomUUID()]) {
      const response = await f.app.inject({
        method: path ? 'POST' : 'GET',
        url: `/api/v1/api-keys/${id}${path}`,
        headers: {
          authorization: `Bearer ${f.operatorKey.secret}`,
          'idempotency-key': 'hidden-key',
        },
        ...(path === '/rotate' ? { payload: { name: 'hidden-key', bindings: read } } : {}),
      });
      assert.equal(response.statusCode, 404);
      errors.push({ code: response.json().code, message: response.json().message });
    }
    assert.deepEqual(errors[0], errors[1]);
  }
  await assert.rejects(f.client.revokeServiceKey(foreign.key.id), { status: 404 });
  await assert.rejects(
    f.client.rotateServiceKey(foreign.key.id, randomUUID(), { name: 'bad-key', bindings: read }),
    { status: 404 },
  );
  await assert.rejects(f.client.createServiceAccount('forbidden', []), { status: 403 });
  await assert.rejects(
    f.client.setServiceDelegation(
      f.operatorKey.key.id,
      outsider.id,
      0,
      ['credential.manage'],
      read,
    ),
    { status: 403 },
  );
  await assert.rejects(
    f.root.setServiceDelegation(
      f.operatorKey.key.id,
      f.operator.id,
      0,
      ['credential.manage'],
      read,
    ),
    { status: 403 },
  );
  const key = await issue(f.client, f.target.id);
  assert.ok(Date.parse(key.key.expiresAt) <= Date.parse(f.operatorKey.key.expiresAt));
  await activate(f, key);
  assert.equal((await f.client.serviceKey(key.key.id)).state, 'active');
  assert.equal((await f.client.serviceKeys(f.target.id)).items.length, 1);
  const next = await f.client.rotateServiceKey(key.key.id, 'rotation', {
    name: 'rotated',
    bindings: read,
  });
  await activate(f, next);
  await f.client.revokeServiceKey(key.key.id);
  await assert.rejects(new ArkvoryClient(f.address, () => key.secret).permissions(), {
    status: 401,
  });
  const policy = await f.client.setServicePolicy(f.target.id, 1, read);
  await assert.rejects(f.client.setServicePolicy(f.target.id, 1, []), { status: 409 });
  const disabled = await f.client.updateServiceAccount(f.target.id, policy.revision, false);
  await assert.rejects(new ArkvoryClient(f.address, () => next.secret).permissions(), {
    status: 401,
  });
  await f.client.updateServiceAccount(f.target.id, disabled.revision, true);
  assert.equal(
    (await new ArkvoryClient(f.address, () => next.secret).permissions()).profile,
    'managed',
  );
  const audit = await f.client.serviceAudit(f.target.id);
  assert.ok(audit.some((e) => e.actor === `service:${f.operator.id}` && e.action === 'key.issue'));
  assert.equal(JSON.stringify(audit).includes(key.secret), false);
  for (const row of (await f.client.serviceKeys(f.target.id)).items)
    assert.equal('secret' in row, false);
  const response = await f.app.inject({
    url: `/api/v1/api-keys/${f.operatorKey.key.id}/delegations`,
    headers: f.headers,
  });
  validateResponse('/api/v1/api-keys/{id}/delegations', 'get', response);
  for (const [method, payload] of [
    ['PUT', { expectedRevision: 1, actions: administrationActions, ceiling: read }],
    ['DELETE', { expectedRevision: 2 }],
  ]) {
    const result = await f.app.inject({
      method,
      url: `/api/v1/api-keys/${f.operatorKey.key.id}/delegations/${f.target.id}`,
      headers: f.headers,
      payload,
    });
    assert.equal(result.statusCode, 200);
    validateResponse('/api/v1/api-keys/{id}/delegations/{accountId}', method.toLowerCase(), result);
  }
});

test('delegation ceilings cannot cross resources, replace broader policies or rotate/revoke broader keys', async (t) => {
  const f = await fixture(t);
  const ceiling = [...binding(['content.read'], 'alpha'), ...binding(['upload.create'], 'beta')];
  await f.grant(['credential.manage', 'policy.manage', 'service-account.manage'], ceiling);
  await assert.rejects(issue(f.client, f.target.id, binding(['upload.create'], 'alpha')), {
    status: 403,
  });
  await assert.rejects(issue(f.client, f.target.id, read), { status: 403 });
  await assert.rejects(f.client.setServicePolicy(f.target.id, 1, ceiling), { status: 403 });
  await assert.rejects(f.client.updateServiceAccount(f.target.id, 1, false), { status: 403 });
  const broad = await issue(f.root, f.target.id);
  await activate(f, broad);
  await assert.rejects(f.client.revokeServiceKey(broad.key.id), { status: 403 });
  await assert.rejects(
    f.client.rotateServiceKey(broad.key.id, randomUUID(), { name: 'narrowed', bindings: [] }),
    { status: 403 },
  );
  await f.grant(['credential.manage'], read, 1);
  await assert.rejects(f.client.serviceKeys(f.target.id), { status: 403 });
  await assert.rejects(f.client.servicePolicy(f.target.id), { status: 403 });
  const issued = await issue(f.client, f.target.id);
  await activate(f, issued);
  await assert.rejects(
    issue(f.client, f.target.id, read, {
      expiresAt: new Date(Date.parse(f.operatorKey.key.expiresAt) + 1000).toISOString(),
    }),
    { status: 403 },
  );
  const replay = await f.client.issueServiceKey(f.target.id, 'receipt', {
    name: 'pending',
    bindings: [],
  });
  assert.equal(
    (await f.client.issueServiceKey(f.target.id, 'receipt', { name: 'pending', bindings: [] }))
      .secret,
    undefined,
  );
  await f.root.removeServiceDelegation(f.operatorKey.key.id, f.target.id, 2);
  await assert.rejects(
    f.client.issueServiceKey(f.target.id, 'receipt', { name: 'pending', bindings: [] }),
    { status: 404 },
  );
  assert.equal((await f.root.serviceKey(replay.key.id)).state, 'pending');
});

test('pending activation revalidates the issuer; active credentials remain independent and rotation copies no administrative grants', async (t) => {
  const f = await fixture(t);
  await f.grant();
  const active = await issue(f.client, f.target.id);
  await activate(f, active);
  const pending = await issue(f.client, f.target.id);
  const tombstone = await f.root.removeServiceDelegation(f.operatorKey.key.id, f.target.id, 1);
  assert.equal(tombstone.enabled, false);
  await assert.rejects(activate(f, pending), { status: 404 });
  assert.equal(
    (await new ArkvoryClient(f.address, () => active.secret).permissions()).profile,
    'managed',
  );
  await assert.rejects(f.grant(undefined, undefined, 0), { status: 409 });
  await f.grant(undefined, undefined, tombstone.revision);
  const rotated = await f.root.rotateServiceKey(f.operatorKey.key.id, 'operator-rotation', {
    name: 'new-operator',
    bindings: [],
  });
  await activate(f, rotated);
  const fresh = new ArkvoryClient(f.address, () => rotated.secret);
  assert.deepEqual((await fresh.serviceAccounts()).items, []);
  await activate(f, pending);
  const oldOperator = await f.root.serviceKey(f.operatorKey.key.id);
  assert.ok(
    Date.parse((await f.root.serviceKey(pending.key.id)).expiresAt) <=
      Date.parse(oldOperator.expiresAt),
  );
  await f.root.revokeServiceKey(f.operatorKey.key.id);
  await assert.rejects(f.client.serviceAccounts(), { status: 401 });
  assert.equal(
    (await new ArkvoryClient(f.address, () => pending.secret).permissions()).profile,
    'managed',
  );
});

test('operator and consumer roles cannot form chains, including inverse promotion and delegated-issued keys', async (t) => {
  const f = await fixture(t);
  await f.grant();
  const consumer = await issue(f.client, f.target.id);
  await activate(f, consumer);
  const other = await f.root.createServiceAccount('other-target', read);
  await assert.rejects(
    f.root.setServiceDelegation(consumer.key.id, other.id, 0, ['credential.manage'], read),
    { status: 409 },
  );
  const rootKey = await issue(f.root, f.target.id);
  await activate(f, rootKey);
  await assert.rejects(
    f.root.setServiceDelegation(rootKey.key.id, other.id, 0, ['credential.manage'], read),
    { status: 409 },
  );
  const secondOperator = await f.root.createServiceAccount('second-operator', []);
  const secondKey = await issue(f.root, secondOperator.id, []);
  await activate(f, secondKey);
  await assert.rejects(
    f.root.setServiceDelegation(secondKey.key.id, f.operator.id, 0, ['service-account.manage'], []),
    { status: 409 },
  );
  await f.root.removeServiceDelegation(f.operatorKey.key.id, f.target.id, 1);
  await f.root.setServiceDelegation(rootKey.key.id, other.id, 0, ['credential.manage'], read);
  await assert.rejects(f.grant(undefined, undefined, 2), { status: 409 });
});

test('administrative mutation rechecks a stale principal after delegation or credential revocation and audit failure rolls back', async (t) => {
  const f = await fixture(t);
  await f.grant();
  const store = new PostgresServices(f.catalog.pool),
    app = new ServiceAccess(store);
  const stale = await store.resolve(f.operatorKey.secret);
  assert.ok(stale);
  // Queue a mutation behind the same transaction barrier as root control changes.
  const blocker = await f.catalog.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(18471,12)');
    const result = app
      .issue(stale, f.target.id, 'blocked-issue', { name: 'blocked-key', bindings: read })
      .then(
        (v) => ({ v }),
        (e) => ({ e }),
      );
    for (let i = 0; i < 100; i++) {
      if (
        (
          await f.catalog.pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=18471 AND objid=12 AND NOT granted",
          )
        ).rowCount
      )
        break;
      if (i === 99) assert.fail('Control mutation never reached transaction barrier');
      await delay(10);
    }
    await blocker.query(
      'UPDATE arkvory_service_delegations SET enabled=false,revision=revision+1 WHERE key_id=$1',
      [f.operatorKey.key.id],
    );
    await blocker.query('COMMIT');
    assert.equal((await result).e?.code, 'not_found');
    assert.equal((await f.root.serviceKeys(f.target.id)).items.length, 0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await f.grant(undefined, undefined, 2);
  await f.root.revokeServiceKey(f.operatorKey.key.id);
  await assert.rejects(app.policy(stale, f.target.id, { expectedRevision: 1, bindings: [] }), {
    code: 'forbidden',
  });
  const root = f.config.keys[0].principal;
  await f.catalog.pool.query(
    "CREATE FUNCTION reject_delegation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER reject_delegation_audit BEFORE INSERT ON arkvory_service_audit FOR EACH ROW EXECUTE FUNCTION reject_delegation_audit()",
  );
  await assert.rejects(
    app.removeDelegation(root, f.operatorKey.key.id, f.target.id, { expectedRevision: 3 }),
  );
  assert.equal((await f.root.serviceDelegations(f.operatorKey.key.id))[0].enabled, true);
});

test('delegation CAS preserves tombstones, concurrent writers cannot overwrite and ceilings are bounded', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.grant(), f.grant()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  const removed = await f.root.removeServiceDelegation(f.operatorKey.key.id, f.target.id, 1);
  await f.grant(undefined, undefined, removed.revision);
  await assert.rejects(f.root.removeServiceDelegation(f.operatorKey.key.id, f.target.id, 1), {
    status: 409,
  });
  const big = Array.from({ length: 17 }, (_, i) => binding(['content.read'], 'repo' + i)[0]);
  await assert.rejects(f.grant(['credential.manage'], big, 3), { status: 400 });
  const invalid = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/api-keys/${f.operatorKey.key.id}/delegations/${f.target.id}`,
    headers: f.headers,
    payload: { expectedRevision: 3, actions: ['identity.manage'], ceiling: [] },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await f.root.serviceDelegations(f.operatorKey.key.id))[0].revision, 3);
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=10');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
});

test('account pages filter delegation before LIMIT and concurrent grants cannot exceed the stored cap', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 80; i++)
    await f.catalog.pool.query(
      'INSERT INTO arkvory_service_accounts(id,name,bindings) VALUES($1,$2,$3)',
      [randomUUID(), 'hidden-' + i, '[]'],
    );
  const visible = [];
  for (let i = 0; i < 63; i++) {
    const account = await f.root.createServiceAccount('visible-' + i, []);
    visible.push(account.id);
    await f.grant(['service-account.read'], [], 0, account.id);
  }
  const other = await f.root.createServiceAccount('last-slot', []);
  const concurrent = await Promise.allSettled([
    f.grant(['service-account.read'], []),
    f.grant(['service-account.read'], [], 0, other.id),
  ]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find((r) => r.status === 'rejected').reason.status, 507);
  visible.push(concurrent[0].status === 'fulfilled' ? f.target.id : other.id);
  const first = await f.client.serviceAccounts();
  assert.equal(first.items.length, 50);
  assert.ok(first.next);
  const last = await f.client.serviceAccounts(first.next);
  assert.equal(last.items.length, 14);
  assert.equal(last.next, null);
  assert.deepEqual([...first.items, ...last.items].map((a) => a.id).sort(), visible.sort());
  await f.root.removeServiceDelegation(f.operatorKey.key.id, visible[0], 1);
  const fresh = await f.root.createServiceAccount('capacity-test', []);
  await assert.rejects(f.grant(['service-account.read'], [], 0, fresh.id), { status: 507 });
  await f.grant(['service-account.read'], [], 2, visible[0]);
  await f.root.revokeServiceKey(f.operatorKey.key.id);
  await assert.rejects(f.client.serviceAccounts(first.next), { status: 401 });
});

test('pending rotation rechecks old rights and disabling or expiring the operator closes administration', async (t) => {
  const f = await fixture(t),
    broad = binding(['content.read', 'artifact.read']);
  await f.root.setServicePolicy(f.target.id, 1, broad);
  await f.grant(['credential.manage'], broad);
  const old = await issue(f.client, f.target.id, broad);
  await activate(f, old);
  const pending = await f.client.rotateServiceKey(old.key.id, 'rotation-after-grant', {
    name: 'narrow',
    bindings: read,
  });
  await f.grant(['credential.manage'], read, 1);
  await assert.rejects(activate(f, pending), { status: 403 });
  assert.equal((await f.root.serviceKey(old.key.id)).expiresAt, old.key.expiresAt);
  const store = new PostgresServices(f.catalog.pool),
    app = new ServiceAccess(store);
  const stale = await store.resolve(f.operatorKey.secret);
  const disabled = await f.root.updateServiceAccount(f.operator.id, 1, false);
  await assert.rejects(f.client.serviceAccounts(), { status: 401 });
  await assert.rejects(
    app.issue(stale, f.target.id, 'stale-disable', { name: 'fail', bindings: read }),
    { code: 'forbidden' },
  );
  await f.root.updateServiceAccount(f.operator.id, disabled.revision, true);
  await f.root.revokeServiceKey(pending.key.id);
  const fresh = await issue(f.client, f.target.id, read);
  await f.catalog.pool.query(
    "UPDATE arkvory_api_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.operatorKey.key.id],
  );
  await assert.rejects(activate(f, fresh), { status: 403 });
  await assert.rejects(f.client.serviceAccounts(), { status: 401 });
});

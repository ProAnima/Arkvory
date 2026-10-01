import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresIdentity } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';

const password = 'long-private-password';
const attempt = (f, remoteAddress, secret, name = 'owner') =>
  f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress,
    payload: { name, password: secret },
  });
async function owner(f) {
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'owner', password },
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json().id;
}
const auditCount = async (f, action) =>
  (
    await f.catalog.pool.query(
      'SELECT count(*)::int AS count FROM arkvory_security_audit WHERE action=$1',
      [action],
    )
  ).rows[0].count;

test('per-address login throttle refuses before hashing and spares other clients', async (t) => {
  const f = await setup(t);
  await owner(f);
  for (let index = 0; index < 10; index++)
    assert.equal((await attempt(f, '203.0.113.1', 'wrong-private-password')).statusCode, 401);
  const before = await auditCount(f, 'auth.login');
  const throttled = await attempt(f, '203.0.113.1', password);
  assert.equal(throttled.statusCode, 429, throttled.body);
  assert.equal(throttled.json().code, 'rate_limited');
  assert.ok(Number(throttled.headers['retry-after']) >= 1);
  assert.equal(await auditCount(f, 'auth.login'), before, 'throttled requests are not journaled');
  // Ten failures from one address leave the owner's own login untouched.
  assert.equal((await attempt(f, '198.51.100.7', password)).statusCode, 200);
  // IPv6 clients share one budget per /64.
  for (let index = 0; index < 10; index++)
    await attempt(f, `2001:db8:5:6::${index + 1}`, 'wrong-private-password');
  assert.equal((await attempt(f, '2001:db8:5:6:ffff::1', password)).statusCode, 429);
});

test('distributed failures trigger a capped account backoff that drains', async (t) => {
  const f = await setup(t);
  const id = await owner(f);
  const debt = async () =>
    (await f.catalog.pool.query('SELECT login_debt FROM arkvory_users WHERE id=$1', [id])).rows[0]
      .login_debt;
  // Below the threshold failures from several addresses accumulate without blocking anyone.
  for (const address of ['192.0.2.1', '192.0.2.2', '192.0.2.3'])
    for (let index = 0; index < 6; index++)
      assert.equal((await attempt(f, address, 'wrong-private-password')).statusCode, 401);
  const accumulated = await debt();
  assert.ok(accumulated > 16 && accumulated <= 18, `debt ${accumulated}`);
  // More distributed pressure (seeded) pushes the next verified failure over the threshold.
  const pressure = async (units) => {
    await f.catalog.pool.query(
      'UPDATE arkvory_users SET login_debt=$2,login_debt_at=now(),locked_until=NULL WHERE id=$1',
      [id, units],
    );
    assert.equal((await attempt(f, '192.0.2.9', 'wrong-private-password')).statusCode, 401);
    const blocked = await attempt(f, '192.0.2.200', password);
    assert.equal(blocked.statusCode, 429, 'even the correct password waits; no hash is spent');
    return Number(blocked.headers['retry-after']);
  };
  const retry = await pressure(25.5);
  assert.ok(retry > 16 && retry <= 32, `Retry-After ${retry}`);
  assert.ok((await debt()) < 27, 'refused attempts add no debt');
  assert.ok((await pressure(500)) <= 120, 'backoff is capped at two minutes');
  // Simulated passage of time: the window ends, the debt drains and success clears it.
  await f.catalog.pool.query(
    "UPDATE arkvory_users SET locked_until=now()-interval '1 second',login_debt_at=now()-interval '1 hour' WHERE id=$1",
    [id],
  );
  assert.equal((await attempt(f, '192.0.2.201', password)).statusCode, 200);
  const cleared = await f.catalog.pool.query(
    'SELECT login_debt,locked_until FROM arkvory_users WHERE id=$1',
    [id],
  );
  assert.deepEqual(cleared.rows[0], { login_debt: 0, locked_until: null });
});

test('disabled registration is advertised publicly and refused', async (t) => {
  const closed = await setup(t);
  const options = await closed.app.inject({ url: '/api/v1/auth/options' });
  assert.equal(options.statusCode, 200, options.body);
  assert.deepEqual(options.json(), { selfRegistration: false });
  const capabilities = await closed.app.inject({
    url: '/api/v1/capabilities',
    headers: closed.headers,
  });
  assert.equal(capabilities.json().features.selfRegistration, false);
  const refused = await closed.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { name: 'visitor', password },
  });
  assert.equal(refused.statusCode, 403);
});

test('enabled registration is throttled and capped below account capacity', async (t) => {
  const f = await setup(t, { allowRegistration: true });
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.equal(capabilities.json().features.selfRegistration, true);
  assert.deepEqual((await f.app.inject({ url: '/api/v1/auth/options' })).json(), {
    selfRegistration: true,
  });
  const register = (name, remoteAddress = '203.0.113.9') =>
    f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      remoteAddress,
      payload: { name, password },
    });
  for (const name of ['visitor-1', 'visitor-2', 'visitor-3'])
    assert.equal((await register(name)).statusCode, 201);
  assert.equal((await register('visitor-4')).statusCode, 429);
  assert.equal(await auditCount(f, 'auth.register'), 3);
  // Self-registration stops at 900 accounts; administrators keep the last 100.
  await f.catalog.pool.query(`
    INSERT INTO arkvory_users(id,name,password_salt,password_hash)
    SELECT gen_random_uuid(),'seed-'||i,repeat('0',32),repeat('0',128) FROM generate_series(1,897) i`);
  const full = await register('visitor-5', '203.0.113.10');
  assert.equal(full.statusCode, 507, full.body);
  const admin = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'staff-account', password },
  });
  assert.equal(admin.statusCode, 201, admin.body);
});

test('anonymous login floods cannot starve authenticated password work', async (t) => {
  const f = await setup(t);
  await owner(f);
  const original = PostgresIdentity.prototype.login;
  PostgresIdentity.prototype.login = async function (...args) {
    await delay(400);
    return original.apply(this, args);
  };
  t.after(() => {
    PostgresIdentity.prototype.login = original;
  });
  const flood = Array.from({ length: 24 }, (_, index) =>
    attempt(f, `198.18.0.${index + 1}`, 'wrong-private-password'),
  );
  await delay(50);
  const started = Date.now();
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'during-flood', password },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.ok(Date.now() - started < 1000, 'administrator work did not queue behind logins');
  const statuses = (await Promise.all(flood)).map((response) => response.statusCode);
  assert.ok(statuses.includes(503), 'the anonymous gate stays bounded');
  assert.ok(statuses.every((status) => status === 401 || status === 503));
});

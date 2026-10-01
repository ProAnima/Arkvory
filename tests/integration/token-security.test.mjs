import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { PostgresSecurityAudit } from '@proanima/arkvory-infrastructure';
import { setup, base, descriptor } from './fixture.mjs';

const day = 24 * 60 * 60 * 1000;
const password = 'long-private-password';
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** Account `alice` with write access to `releases` through a group; returns a fresh session. */
async function account(f, { administrator = false } = {}) {
  const user = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'alice', password, administrator },
  });
  assert.equal(user.statusCode, 201, user.body);
  const group = await f.app.inject({
    method: 'POST',
    url: '/api/v1/access-groups',
    headers: f.headers,
    payload: { name: 'writers' },
  });
  const groupId = group.json().id;
  for (const request of [
    { method: 'PUT', url: `/api/v1/access-groups/${groupId}/members/${user.json().id}` },
    {
      method: 'PUT',
      url: `/api/v1/access-groups/${groupId}/grants/releases`,
      payload: { access: 'write' },
    },
  ])
    assert.equal((await f.app.inject({ ...request, headers: f.headers })).statusCode, 204);
  return { userId: user.json().id, groupId, session: await login(f) };
}
async function login(f, secret = password, remoteAddress = '198.51.100.10') {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress,
    payload: { name: 'alice', password: secret },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token;
}
async function personalToken(f, session, payload = { name: 'ci' }) {
  return f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/tokens',
    headers: bearer(session),
    payload,
  });
}
const upload = (f, token, key) =>
  f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...bearer(token), 'idempotency-key': key },
    payload: descriptor(Buffer.from(key)),
  });
async function audit(f, query = '') {
  const response = await f.app.inject({
    url: `/api/v1/security/audit${query}`,
    headers: f.headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test('personal tokens cannot mint tokens, manage passwords or administer accounts', async (t) => {
  const f = await setup(t);
  const { session } = await account(f, { administrator: true });
  const created = await personalToken(f, session);
  assert.equal(created.statusCode, 201, created.body);
  const pat = created.json().token;
  const me = (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(pat) })).json();
  assert.equal(me.credential, 'personal-token');
  assert.equal(me.administrator, false, 'tokens never inherit the administrator flag');
  assert.equal((await personalToken(f, pat, { name: 'child' })).statusCode, 403);
  for (const request of [
    { url: '/api/v1/auth/tokens' },
    { method: 'DELETE', url: `/api/v1/auth/tokens/${created.json().id}` },
    {
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { currentPassword: password, newPassword: 'another-private-password' },
    },
    { url: '/api/v1/users' },
    { url: '/api/v1/security/audit' },
    { method: 'POST', url: '/api/v1/users', payload: { name: 'mallory', password } },
  ])
    assert.equal(
      (await f.app.inject({ ...request, headers: bearer(pat) })).statusCode,
      403,
      `${request.method ?? 'GET'} ${request.url}`,
    );
  // The parent token still works: the failed child mint changed nothing.
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(pat) })).statusCode,
    200,
  );
  const denied = (await audit(f)).items.filter((entry) => entry.outcome === 'denied');
  assert.deepEqual(denied.map((entry) => [entry.action, entry.credential, entry.code]).sort(), [
    ['auth.password.change', 'personal-token', 'session_required'],
    ['token.create', 'personal-token', 'session_required'],
    ['token.list', 'personal-token', 'session_required'],
    ['token.revoke', 'personal-token', 'session_required'],
  ]);
});

test('read tokens are denied every write while read-write tokens keep account grants', async (t) => {
  const f = await setup(t);
  const { session } = await account(f);
  const read = (await personalToken(f, session, { name: 'reader', scope: 'read' })).json();
  const write = (await personalToken(f, session, { name: 'writer', scope: 'read-write' })).json();
  assert.equal(read.scope, 'read');
  const me = (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(read.token) })).json();
  assert.deepEqual(me.grants, [{ repository: 'releases', permissions: ['read'] }]);
  assert.equal(me.tokenScope, 'read');
  assert.equal(
    (await f.app.inject({ url: `${base}/packages`, headers: bearer(read.token) })).statusCode,
    200,
  );
  assert.equal((await upload(f, read.token, 'read-scope-write')).statusCode, 403);
  const blocked = await f.app.inject({
    method: 'PUT',
    url: `${base}/storage/policy`,
    headers: bearer(read.token),
    payload: {},
  });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().message, 'Read-only personal access token');
  assert.equal((await upload(f, write.token, 'read-write-scope')).statusCode, 201);
  const logout = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: bearer(read.token),
  });
  assert.equal(logout.statusCode, 204);
});

test('token expiry is mandatory, bounded and validated', async (t) => {
  const f = await setup(t);
  const { session } = await account(f);
  const before = Date.now();
  const created = (await personalToken(f, session)).json();
  const lifetime = Date.parse(created.expiresAt) - before;
  assert.ok(Math.abs(lifetime - 90 * day) < 60_000, `default lifetime ${lifetime}`);
  assert.equal(created.scope, 'read-write');
  for (const expiresAt of [
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + 367 * day).toISOString(),
    'not-a-date',
  ]) {
    const rejected = await personalToken(f, session, { name: 'bad', expiresAt });
    assert.equal(rejected.statusCode, 400, `${expiresAt}: ${rejected.body}`);
  }
  const year = new Date(Date.now() + 365 * day - 60_000).toISOString();
  assert.equal(
    (await personalToken(f, session, { name: 'year', expiresAt: year })).statusCode,
    201,
  );
  // Legacy rows without expiry stop working at the maximum lifetime.
  await f.catalog.pool.query(
    "UPDATE arkvory_user_tokens SET expires_at=NULL,created_at=now()-interval '366 days' WHERE id=$1",
    [created.id],
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(created.token) })).statusCode,
    401,
  );
});

test('password change and administrator reset revoke every personal token', async (t) => {
  const f = await setup(t);
  const { userId, session } = await account(f);
  const first = (await personalToken(f, session, { name: 'one' })).json().token;
  const changed = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    headers: bearer(session),
    payload: { currentPassword: password, newPassword: 'second-private-password' },
  });
  assert.equal(changed.statusCode, 204, changed.body);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(first) })).statusCode,
    401,
  );
  const renewed = await login(f, 'second-private-password');
  const second = (await personalToken(f, renewed, { name: 'two' })).json().token;
  const reset = await f.app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${userId}`,
    headers: f.headers,
    payload: { password: 'third-private-password' },
  });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(second) })).statusCode,
    401,
  );
  const entries = (await audit(f)).items;
  const change = entries.find((entry) => entry.action === 'auth.password.change');
  assert.equal(change.outcome, 'success');
  assert.equal(change.details.revokedTokens, 1);
  assert.equal(change.credential, 'session');
  const resetEntry = entries.find((entry) => entry.action === 'user.password.reset');
  assert.deepEqual(
    [resetEntry.actor, resetEntry.credential, resetEntry.details.revokedTokens],
    ['test-writer', 'file-key', 1],
  );
});

test('administrators list and revoke account tokens; active tokens are never hidden', async (t) => {
  const f = await setup(t);
  const { userId, session } = await account(f);
  // Sixty revoked rows newer than the active token must not push it out of the listing.
  const active = (await personalToken(f, session, { name: 'active' })).json();
  await f.catalog.pool.query(
    `INSERT INTO arkvory_user_tokens(id,user_id,name,token_hash,token_prefix,expires_at,revoked_at,created_at)
     SELECT gen_random_uuid(),$1,'old-'||i,md5(i::text)||md5('x'||i),'pat_old...',
            now()+interval '1 day',now(),now()+make_interval(secs=>i)
     FROM generate_series(1,60) i`,
    [userId],
  );
  const own = await f.app.inject({ url: '/api/v1/auth/tokens', headers: bearer(session) });
  assert.equal(own.json().items[0].id, active.id);
  assert.equal(own.json().items.length, 61);
  const sdk = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  const listed = await sdk.administration.users.tokens(userId);
  assert.equal(listed[0].id, active.id);
  assert.equal(listed[0].revoked, false);
  await sdk.administration.users.revokeToken(userId, active.id);
  await sdk.administration.users.revokeToken(userId, active.id);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: bearer(active.token) })).statusCode,
    401,
  );
  const missing = await f.app.inject({
    method: 'DELETE',
    url: `/api/v1/users/${userId}/tokens/00000000-0000-4000-8000-000000000000`,
    headers: f.headers,
  });
  assert.equal(missing.statusCode, 404);
  const revokes = (await sdk.administration.security.audit()).items.filter(
    (entry) => entry.action === 'token.revoke',
  );
  assert.equal(revokes.length, 1, 'idempotent repeat is not journaled twice');
  assert.equal(revokes[0].actor, 'test-writer');
});

test('identity events are journaled append-only and paginated newest first', async (t) => {
  const f = await setup(t);
  await account(f);
  const failed = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: '203.0.113.50',
    payload: { name: 'nobody', password },
  });
  assert.equal(failed.statusCode, 401);
  const all = await audit(f);
  const actions = all.items.map((entry) => entry.action);
  for (const action of [
    'user.create',
    'group.create',
    'group.member.add',
    'group.grant.set',
    'auth.login',
  ])
    assert.ok(actions.includes(action), action);
  assert.deepEqual(
    [all.items[0].action, all.items[0].outcome, all.items[0].code, all.items[0].clientIp],
    ['auth.login', 'failure', 'unknown_account', '203.0.113.50'],
  );
  assert.equal(all.items[0].target, 'nobody');
  const ids = all.items.map((entry) => BigInt(entry.id));
  assert.deepEqual(
    [...ids].sort((a, b) => (a > b ? -1 : 1)),
    ids,
  );
  const first = await audit(f, '?limit=2');
  assert.equal(first.items.length, 2);
  const second = await audit(f, `?limit=2&after=${first.next}`);
  assert.equal(second.items[0].id, all.items[2].id);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/security/audit?limit=0', headers: f.headers })).statusCode,
    400,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/security/audit', headers: f.readerHeaders })).statusCode,
    403,
  );
  await assert.rejects(
    f.catalog.pool.query("UPDATE arkvory_security_audit SET action='x'"),
    /append-only/,
  );
  await assert.rejects(f.catalog.pool.query('DELETE FROM arkvory_security_audit'), /append-only/);
});

test('journal retention deletes only through its bounded batch', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query(`
    INSERT INTO arkvory_security_audit(occurred_at,action,outcome)
    SELECT now()-interval '400 days','auth.login','failure' FROM generate_series(1,3);
    INSERT INTO arkvory_security_audit(action,outcome)
    SELECT 'auth.login','failure' FROM generate_series(1,6)`);
  const journal = new PostgresSecurityAudit(f.catalog.pool);
  assert.equal(await journal.prune({ maxAgeDays: 365, maxRows: 4, batch: 2 }), 2);
  assert.equal(await journal.prune({ maxAgeDays: 365, maxRows: 4, batch: 100 }), 3);
  const left = await f.catalog.pool.query(
    "SELECT count(*)::int AS count, min(occurred_at)>now()-interval '1 day' AS recent FROM arkvory_security_audit",
  );
  assert.deepEqual(left.rows[0], { count: 4, recent: true });
  assert.equal(await journal.prune({ maxAgeDays: 365, maxRows: 4, batch: 100 }), 0);
});

// Error contract against the real API and PostgreSQL (ADR 0051).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { nativeErrorSchema } from '@proanima/arkvory-contracts';
import { setup, create, base } from './fixture.mjs';
import { validateJson } from '../api-schema.mjs';

const digest = (token) => createHash('sha256').update(token).digest('hex');
const password = 'long-private-password';
const uuid = /^[0-9a-f-]{36}$/;

function envelope(response, status, code, reason) {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json();
  validateJson(nativeErrorSchema, body);
  assert.deepEqual([body.code, body.reason], [code, reason], response.body);
  assert.equal(body.requestId, response.headers['x-request-id']);
  assert.match(body.requestId, uuid);
  return body;
}
const login = (f, name, secret, remoteAddress = '192.0.2.10') =>
  f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress,
    payload: { name, password: secret },
  });
const me = (f, token) =>
  f.app.inject({
    url: '/api/v1/auth/me',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
async function user(f, name) {
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name, password },
  });
  assert.equal(created.statusCode, 201, created.body);
}

test('unknown routes are 404 for every caller and never echo the URL; wrong methods are 405', async (t) => {
  const f = await setup(t);
  for (const headers of [{}, f.headers, { authorization: 'Bearer ' + 'x'.repeat(40) }]) {
    const missing = await f.app.inject({ url: '/api/v1/no-such/%3Cb%3E?q=canary', headers });
    const body = envelope(missing, 404, 'not_found', 'route_not_found');
    assert.doesNotMatch(missing.body, /no-such|canary|%3C|<b>/);
    assert.equal(body.message, 'No API operation at this path');
    const wrong = await f.app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers });
    envelope(wrong, 405, 'invalid_input', 'method_not_allowed');
    assert.equal(wrong.headers.allow, 'GET, HEAD');
  }
  // A real operation still authenticates first.
  envelope(await me(f), 401, 'unauthorized', 'credential_missing');
  assert.equal((await me(f)).headers['www-authenticate'], 'Bearer');
});

test('request shape failures: 413, 415, malformed JSON and validation details per field', async (t) => {
  const f = await setup(t);
  const json = { ...f.headers, 'content-type': 'application/json' };
  const groups = (headers, payload) =>
    f.app.inject({ method: 'POST', url: '/api/v1/access-groups', headers, payload });
  envelope(
    await groups(json, JSON.stringify({ name: 'x'.repeat(70 * 1024) })),
    413,
    'invalid_input',
    'body_too_large',
  );
  envelope(
    await groups({ ...f.headers, 'content-type': 'application/xml' }, '<group/>'),
    415,
    'invalid_input',
    'unsupported_media_type',
  );
  envelope(await groups(json, '{"name":'), 400, 'invalid_input', 'malformed_json');
  const users = (payload) =>
    f.app.inject({ method: 'POST', url: '/api/v1/users', headers: f.headers, payload });
  const cases = [
    [{ name: 'valid-name', password, extra: 1 }, [{ field: '/extra', problem: 'unknown_field' }]],
    [{ name: 'bad name!', password }, [{ field: '/name', problem: 'invalid' }]],
    [{ name: 'valid-name', password: 'short' }, [{ field: '/password', problem: 'invalid' }]],
    [{ password }, [{ field: '/name', problem: 'required' }]],
  ];
  for (const [payload, details] of cases)
    assert.deepEqual(
      envelope(await users(payload), 400, 'invalid_input', 'validation').details,
      details,
      JSON.stringify(payload),
    );
  const anonymous = await login(f, 'someone', undefined);
  assert.deepEqual(envelope(anonymous, 400, 'invalid_input', 'validation').details, [
    { field: '/password', problem: 'required' },
  ]);
  // Fastify body schema of upload creation names the member too.
  const upload = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: { name: 'a.bin', size: 5, sha256: '0'.repeat(64) },
  });
  assert.deepEqual(envelope(upload, 400, 'invalid_input', 'validation').details, [
    { field: '/size', problem: 'type' },
  ]);
});

test('credential failures separate expiry, revocation and typed passwords; names stay private', async (t) => {
  const f = await setup(t);
  await user(f, 'err-user');
  const wrong = envelope(
    await login(f, 'err-user', 'wrong-private-password'),
    401,
    'unauthorized',
    'invalid_credentials',
  );
  const unknown = envelope(
    await login(f, 'nobody-here', password),
    401,
    'unauthorized',
    'invalid_credentials',
  );
  assert.equal(wrong.message, unknown.message);
  assert.equal(wrong.details, undefined);
  const sessions = [];
  for (let index = 0; index < 3; index++) {
    const session = await login(f, 'err-user', password);
    assert.equal(session.statusCode, 200, session.body);
    sessions.push(session.json().token);
  }
  envelope(await me(f, 'short'), 401, 'unauthorized', 'credential_invalid');
  envelope(await me(f, 'dps_' + 'A'.repeat(43)), 401, 'unauthorized', 'credential_invalid');
  const change = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    headers: { authorization: `Bearer ${sessions[0]}` },
    payload: { currentPassword: 'wrong-private-password', newPassword: 'next-private-password' },
  });
  assert.deepEqual(envelope(change, 401, 'unauthorized', 'current_password_invalid').details, [
    { field: '/currentPassword', problem: 'invalid' },
  ]);
  await f.catalog.pool.query(
    "UPDATE arkvory_user_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [digest(sessions[0])],
  );
  envelope(await me(f, sessions[0]), 401, 'unauthorized', 'session_expired');
  await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${sessions[1]}` },
  });
  envelope(await me(f, sessions[1]), 401, 'unauthorized', 'credential_invalid');
  const tokens = [];
  for (const name of ['ci', 'old']) {
    const created = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/tokens',
      headers: { authorization: `Bearer ${sessions[2]}` },
      payload: { name },
    });
    assert.equal(created.statusCode, 201, created.body);
    tokens.push(created.json());
  }
  await f.catalog.pool.query(
    "UPDATE arkvory_user_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [digest(tokens[0].token)],
  );
  envelope(await me(f, tokens[0].token), 401, 'unauthorized', 'token_expired');
  await f.app.inject({
    method: 'DELETE',
    url: `/api/v1/auth/tokens/${tokens[1].id}`,
    headers: { authorization: `Bearer ${sessions[2]}` },
  });
  envelope(await me(f, tokens[1].token), 401, 'unauthorized', 'credential_invalid');
  // Ten failures exhaust the per-address budget; the refusal carries the same delay twice.
  for (let index = 0; index < 10; index++)
    await login(f, 'err-user-' + String(index), password, '203.0.113.9');
  const throttled = await login(f, 'err-user', password, '203.0.113.9');
  const body = envelope(throttled, 429, 'rate_limited', 'login_attempts');
  assert.ok(body.retryAfterSeconds >= 1);
  assert.equal(throttled.headers['retry-after'], String(body.retryAfterSeconds));
});

test('capacity and conflict reasons name the exhausted limit and the stale state', async (t) => {
  const f = await setup(t, { capacityBytes: 64 });
  envelope(await create(f, Buffer.alloc(65)), 507, 'capacity_exceeded', 'catalog_limit');
  const created = await create(f, Buffer.from('expiring'));
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [id],
  );
  const late = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: Buffer.from('expiring'),
  });
  envelope(late, 409, 'conflict', 'upload_expired');
  // Same idempotency key, another descriptor.
  const replay = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': 'reused-key' },
    payload: { name: 'a.bin', size: '1', sha256: '0'.repeat(64) },
  });
  assert.equal(replay.statusCode, 201, replay.body);
  const reused = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': 'reused-key' },
    payload: { name: 'b.bin', size: '1', sha256: '0'.repeat(64) },
  });
  envelope(reused, 409, 'conflict', 'idempotency_mismatch');
  for (let index = 0; index < 100; index++) {
    const group = await f.app.inject({
      method: 'POST',
      url: '/api/v1/access-groups',
      headers: f.headers,
      payload: { name: `group-${String(index)}` },
    });
    assert.equal(group.statusCode, 201, group.body);
  }
  const full = await f.app.inject({
    method: 'POST',
    url: '/api/v1/access-groups',
    headers: f.headers,
    payload: { name: 'group-extra' },
  });
  envelope(full, 507, 'capacity_exceeded', 'group_limit');
  const duplicate = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'twin-user', password },
  });
  assert.equal(duplicate.statusCode, 201);
  envelope(
    await f.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: f.headers,
      payload: { name: 'twin-user', password },
    }),
    409,
    'conflict',
    'already_exists',
  );
});

test('arkvoryctl reports server code, reason and request ID; --verbose logs exchanges only', async (t) => {
  const f = await setup(t);
  const server = (await f.listen()) + '/';
  const token = f.headers.authorization.slice(7);
  const env = {
    ...process.env,
    ARKVORY_CLI_HOME: join(f.directory, 'cli'),
    ARKVORY_BASE_URL: server,
  };
  delete env.ARKVORY_TOKEN_FILE;
  const run = async (args, credential, expected) => {
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [resolve('apps/cli/dist/main.js'), ...args],
        { env: { ...env, ARKVORY_TOKEN: credential }, windowsHide: true, timeout: 30000 },
      );
      assert.equal(expected, 0);
      return result;
    } catch (error) {
      assert.equal(error.code, expected, error.stderr);
      return error;
    }
  };
  const verbose = await run(['doctor', '--verbose', '--json'], token, 0);
  assert.match(
    verbose.stderr,
    /^arkvoryctl: GET \/api\/v1\/capabilities 200 \d+ ms request [0-9a-f-]{36}$/m,
  );
  assert.equal(verbose.stderr.includes(token), false);
  assert.doesNotMatch(verbose.stderr, /Bearer|authorization/i);
  const invalid = 'invalid-' + 'c'.repeat(40);
  const json = JSON.parse((await run(['list', '--json'], invalid, 3)).stderr).error;
  assert.deepEqual(
    [json.code, json.status, json.serverCode, json.reason, json.exitCode],
    ['http_error', 401, 'unauthorized', 'credential_invalid', 3],
  );
  assert.match(json.requestId, uuid);
  const text = (await run(['list', '--lang', 'en'], invalid, 3)).stderr;
  assert.match(
    text,
    /^Arkvory: http_error HTTP 401 unauthorized\/credential_invalid: Valid service key required\. .+ Request ID: [0-9a-f-]{36}\s*$/,
  );
  assert.equal(text.includes(invalid), false);
});

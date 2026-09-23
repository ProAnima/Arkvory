import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.mjs';

test('an allowed external UI can preflight and call the bearer API', async (t) => {
  const f = await setup(t, { corsOrigins: ['https://ui.example.test'] });
  const origin = 'https://ui.example.test';
  const preflight = await f.app.inject({
    method: 'OPTIONS',
    url: '/api/v1/users',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.statusCode, 204, preflight.body);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.match(preflight.headers['access-control-allow-headers'], /authorization/);
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined);

  const partPreflight = await f.app.inject({
    method: 'OPTIONS',
    url: '/api/v1/repositories/releases/uploads/example/parts/0',
    headers: {
      origin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization, content-type, x-content-sha256',
    },
  });
  assert.equal(partPreflight.statusCode, 204, partPreflight.body);
  assert.match(partPreflight.headers['access-control-allow-headers'], /x-content-sha256/);

  const authenticated = await f.app.inject({
    url: '/api/v1/auth/me',
    headers: { ...f.headers, origin },
  });
  assert.equal(authenticated.statusCode, 200, authenticated.body);
  assert.equal(authenticated.headers['access-control-allow-origin'], origin);
  assert.match(authenticated.headers['access-control-expose-headers'], /X-Request-Id/);
  const unauthorized = await f.app.inject({
    url: '/api/v1/auth/me',
    headers: { origin },
  });
  assert.equal(unauthorized.statusCode, 401, unauthorized.body);
  assert.equal(unauthorized.headers['access-control-allow-origin'], origin);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: f.headers })).statusCode,
    200,
  );
});

test('unlisted origins and unsupported preflights remain closed', async (t) => {
  const f = await setup(t, { corsOrigins: ['https://ui.example.test'] });
  const rejected = await f.app.inject({
    url: '/api/v1/auth/me',
    headers: { ...f.headers, origin: 'https://other.example.test' },
  });
  assert.equal(rejected.statusCode, 403, rejected.body);
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  for (const requested of [
    { 'access-control-request-method': 'PATCH' },
    { 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-api-key' },
  ]) {
    const response = await f.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/me',
      headers: { origin: 'https://ui.example.test', ...requested },
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});

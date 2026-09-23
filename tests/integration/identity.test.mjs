import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, base, descriptor } from './fixture.mjs';

test('registered accounts inherit and lose repository access through groups', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('group-readable artifact');
  const artifact = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': 'group-readable-artifact' },
    payload: descriptor(bytes),
  });
  assert.equal(artifact.statusCode, 201, artifact.body);
  const artifactId = artifact.json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${artifactId}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/users', headers: f.readerHeaders })).statusCode,
    403,
  );
  const user = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'alice', password: 'long-private-password' },
  });
  assert.equal(user.statusCode, 201, user.body);
  const userId = user.json().id;
  assert.equal(Object.hasOwn(user.json(), 'password_hash'), false);
  const group = await f.app.inject({
    method: 'POST',
    url: '/api/v1/access-groups',
    headers: f.headers,
    payload: { name: 'readers' },
  });
  assert.equal(group.statusCode, 201, group.body);
  const groupId = group.json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/v1/access-groups/${groupId}/grants/releases`,
        headers: f.headers,
        payload: { access: 'read' },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/v1/access-groups/${groupId}/members/${userId}`,
        headers: f.headers,
      })
    ).statusCode,
    204,
  );
  const login = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { name: 'alice', password: 'long-private-password' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { authorization: `Bearer ${login.json().token}` };
  assert.equal((await f.app.inject({ url: `${base}/packages`, headers })).statusCode, 200);
  const download = await f.app.inject({ url: `${base}/artifacts/${artifactId}/content`, headers });
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, bytes);
  assert.equal((await f.app.inject({ url: '/api/v1/users', headers })).statusCode, 403);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/uploads`,
        headers: { ...headers, 'idempotency-key': 'alice-write-check' },
        payload: descriptor(Buffer.from('sample')),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/v1/access-groups/${groupId}/grants/releases`,
        headers: f.headers,
        payload: { access: 'write' },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/uploads`,
        headers: { ...headers, 'idempotency-key': 'alice-write-check' },
        payload: descriptor(Buffer.from('sample')),
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'DELETE',
        url: `/api/v1/access-groups/${groupId}/members/${userId}`,
        headers: f.headers,
      })
    ).statusCode,
    204,
  );
  assert.equal((await f.app.inject({ url: `${base}/packages`, headers })).statusCode, 403);
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${artifactId}/content`, headers })).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers })).statusCode,
    204,
  );
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', headers })).statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { name: 'alice', password: 'wrong-private-password' },
      })
    ).statusCode,
    401,
  );
  for (let attempt = 0; attempt < 4; attempt++)
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { name: 'alice', password: 'wrong-private-password' },
        })
      ).statusCode,
      401,
    );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { name: 'alice', password: 'long-private-password' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userId}`,
        headers: f.headers,
        payload: { enabled: false, password: 'replacement-password' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { name: 'alice', password: 'replacement-password' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userId}`,
        headers: f.headers,
        payload: { enabled: true },
      })
    ).statusCode,
    200,
  );
  const renewed = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { name: 'alice', password: 'replacement-password' },
  });
  assert.equal(renewed.statusCode, 200, renewed.body);
  let newest = renewed.json().token;
  for (let index = 0; index < 32; index++) {
    const additional = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { name: 'alice', password: 'replacement-password' },
    });
    assert.equal(additional.statusCode, 200, additional.body);
    newest = additional.json().token;
  }
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${renewed.json().token}` },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${newest}` },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { authorization: `Bearer ${newest}` },
        payload: { currentPassword: 'incorrect-password', newPassword: 'final-private-password' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${newest}` },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: { authorization: `Bearer ${newest}` },
        payload: { currentPassword: 'replacement-password', newPassword: 'final-private-password' },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${newest}` },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { name: 'alice', password: 'final-private-password' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password',
        headers: f.headers,
        payload: { currentPassword: 'replacement-password', newPassword: 'final-private-password' },
      })
    ).statusCode,
    403,
  );
});

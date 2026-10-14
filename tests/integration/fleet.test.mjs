import test from 'node:test';
import assert from 'node:assert/strict';
import { readTopology } from '@proanima/arkvory-contracts';
import { setup } from './fixture.mjs';

test('an installation describes itself to the fleet console; only its administrator may read it (ADR 0077)', async (t) => {
  const f = await setup(t, { siteName: 'Main site' });
  const answer = await f.app.inject({ url: '/api/v1/system/topology', headers: f.headers });
  assert.equal(answer.statusCode, 200, answer.body);
  const topology = readTopology(answer.json());
  assert.equal(topology.site.name, 'Main site');
  assert.equal(topology.site.role, 'api');
  assert.ok(topology.site.schema >= 38);
  assert.deepEqual(topology.health, { available: true, writable: true, draining: false });
  assert.equal(topology.replication, null);
  assert.deepEqual(topology.gateways, []);
  assert.deepEqual(topology.mirrors, []);
  assert.equal(topology.downloads.strategy, 'ordered');
  const reader = await f.app.inject({ url: '/api/v1/system/topology', headers: f.readerHeaders });
  assert.equal(reader.statusCode, 403);
  assert.equal(reader.json().reason, 'administrator_required');
});

test('a site pairs with a controller once by code; the fleet key reaches only its routes until revoked', async (t) => {
  const f = await setup(t, { siteName: 'Branch' });
  const call = (method, url, headers = {}, payload) =>
    f.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  assert.equal(
    (await call('POST', '/api/v1/system/fleet/pairings', f.readerHeaders)).statusCode,
    403,
  );
  const made = await call('POST', '/api/v1/system/fleet/pairings', f.headers);
  assert.equal(made.statusCode, 201, made.body);
  const { code } = made.json();
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  // A wrong code, then the right one in another spelling, then the same code again.
  const wrong = await call(
    'POST',
    '/api/v1/system/fleet/enrollment',
    {},
    { code: 'AAAA-AAAA-AAAA', name: 'Main' },
  );
  assert.equal(wrong.statusCode, 401);
  const enrolled = await call(
    'POST',
    '/api/v1/system/fleet/enrollment',
    {},
    {
      code: code.toLowerCase().replaceAll('-', ' '),
      name: 'Main',
    },
  );
  assert.equal(enrolled.statusCode, 201, enrolled.body);
  const { key, site } = enrolled.json();
  assert.match(key, /^afk_[A-Za-z0-9_-]{43}$/);
  assert.equal(site.name, 'Branch');
  const again = await call('POST', '/api/v1/system/fleet/enrollment', {}, { code, name: 'Thief' });
  assert.equal(again.statusCode, 401);
  const fleet = { authorization: `Bearer ${key}` };
  assert.equal((await call('GET', '/api/v1/system/topology', fleet)).statusCode, 200);
  for (const [method, url] of [
    ['GET', '/api/v1/repositories'],
    ['POST', '/api/v1/system/fleet/pairings'],
    ['GET', '/api/v1/system/fleet/controllers'],
    ['GET', '/api/v1/system/updates'],
  ]) {
    const refused = await call(method, url, fleet);
    assert.equal(refused.statusCode, 403, `${method} ${url}`);
    assert.equal(refused.json().reason, 'permission_missing');
  }
  const listed = (await call('GET', '/api/v1/system/fleet/controllers', f.headers)).json().items;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Main');
  assert.ok(listed[0].usedAt);
  assert.equal(
    (await call('DELETE', `/api/v1/system/fleet/controllers/${listed[0].id}`, f.headers))
      .statusCode,
    204,
  );
  assert.equal((await call('GET', '/api/v1/system/topology', fleet)).statusCode, 401);
  assert.equal(
    (await call('DELETE', `/api/v1/system/fleet/controllers/${listed[0].id}`, f.headers))
      .statusCode,
    404,
  );
});

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

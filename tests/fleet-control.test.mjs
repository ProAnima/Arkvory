import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetControl } from '@proanima/arkvory-application';

const ID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-10-15T12:00:00.000Z';

/** A registry in memory with one paired site; every observation is kept in order. */
function store() {
  const observed = [];
  const site = {
    id: ID,
    name: 'Branch',
    url: 'https://branch.example',
    pin: null,
    certificate: null,
    sealedKey: new Uint8Array([1]),
    addedBy: 'admin',
    addedAt: '2026-10-15T00:00:00.000Z',
    seenAt: null,
    state: 'pending',
    error: null,
    topology: null,
  };
  return {
    observed,
    list: async () => [site],
    get: async (id) => (id === ID ? site : null),
    add: async () => undefined,
    observe: async (id, observation) => {
      observed.push(observation);
    },
    remove: async () => undefined,
  };
}

function control(sites, topology) {
  const client = {
    origin: (url) => url,
    certificate: async () => null,
    enroll: async () => {
      throw new Error('not used');
    },
    topology,
    read: async () => ({ status: 200, body: null }),
    change: async () => ({ status: 200, body: null }),
  };
  const seal = { seal: () => new Uint8Array([1]), open: () => 'afk_key' };
  return new FleetControl(
    sites,
    client,
    seal,
    () => ID,
    'Main',
    () => AT,
  );
}

test('a topology too large for the registry in UTF-8 bytes is recorded as invalid', async () => {
  const sites = store();
  // 100000 characters, 200000 bytes: within the column by characters, beyond it in jsonb text.
  const large = { site: { name: 'Branch' }, note: 'я'.repeat(100000) };
  await control(sites, async () => large).poll(ID);
  assert.deepEqual(sites.observed, [{ state: 'invalid', error: 'invalid', at: AT }]);
  const small = { site: { name: 'Branch' }, note: 'я'.repeat(1000) };
  await control(sites, async () => small).poll(ID);
  assert.equal(sites.observed[1].state, 'ok');
  // The time of the read is the application's clock, not the database's.
  assert.equal(sites.observed[1].at, AT);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetControl } from '@proanima/arkvory-application';

const ID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-10-15T12:00:00.000Z';

/** A registry in memory with paired sites; every observation is kept in order. */
function store(count = 1) {
  const observed = [];
  const at = (index) => ({
    id: index === 0 ? ID : `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
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
  });
  const sites = Array.from({ length: count }, (_, index) => at(index));
  return {
    observed,
    list: async () => sites,
    ids: async () => sites.map((site) => site.id),
    get: async (id) => sites.find((site) => site.id === id) ?? null,
    add: async () => undefined,
    observe: async (id, observation) => {
      observed.push(observation);
    },
    remove: async () => undefined,
  };
}

function control(sites, topology, read = async () => ({ status: 200, body: null })) {
  const client = {
    origin: (url) => url,
    certificate: async () => null,
    enroll: async () => {
      throw new Error('not used');
    },
    topology,
    read,
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

test('a site is read once at a time: a later caller joins the read in flight', async () => {
  const sites = store();
  let calls = 0;
  let answer;
  const fleet = control(sites, () => {
    calls++;
    return new Promise((resolve) => {
      answer = resolve;
    });
  });
  const first = fleet.poll(ID, 'admin');
  const second = fleet.poll(ID, 'fleet');
  await new Promise((resolve) => setImmediate(resolve));
  answer({ site: { name: 'Branch' } });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(sites.observed.length, 1);
  // Once it ended, the next caller reads the site again.
  const third = fleet.poll(ID);
  await new Promise((resolve) => setImmediate(resolve));
  answer({ site: { name: 'Branch' } });
  await third;
  assert.equal(calls, 2);
});

test('an aborted round ends the reads in flight, takes no further site and records nothing', async () => {
  const sites = store(20);
  const signals = [];
  const fleet = control(sites, (_site, _key, _actor, signal) => {
    signals.push(signal);
    // As the HTTP client does: an abort ends the request as unreachable.
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { code: 'unreachable' }));
      });
    });
  });
  const stop = new AbortController();
  const round = fleet.pollAll(stop.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 8);
  assert.ok(signals.every((signal) => signal === stop.signal));
  stop.abort();
  await round;
  assert.equal(signals.length, 8);
  assert.deepEqual(sites.observed, []);
});

test('a forwarded read carries the caller signal to the site', async () => {
  const seen = [];
  const fleet = control(
    store(),
    async () => ({}),
    async (_site, _key, _actor, path, signal) => {
      seen.push({ path, signal });
      return { status: 200, body: { ok: true } };
    },
  );
  const caller = new AbortController();
  const answer = await fleet.read(ID, '/api/v1/repositories', 'admin', () => true, caller.signal);
  assert.deepEqual(answer, { status: 200, body: { ok: true } });
  assert.equal(seen[0].signal, caller.signal);
});

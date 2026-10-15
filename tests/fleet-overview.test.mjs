import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRegistry } from '@proanima/arkvory-infrastructure';
import { readFleetOverview } from '@proanima/arkvory-contracts';
import { FleetOverviewSource } from '../apps/api/dist/fleet-overview.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const topology = (name, mirrors = [], extra = {}) => ({
  collectedAt: new Date(now).toISOString(),
  site: { name, version: '1.2.0', schema: 40, role: 'api' },
  health: { available: true, writable: true, draining: false },
  replication: null,
  gateways: [],
  mirrors,
  updates: null,
  downloads: {
    strategy: 'ordered',
    sessions: 16,
    active: 0,
    waiting: 0,
    oldestWaitSeconds: 0,
    bytesPerSecond: 0,
  },

  ...extra,
});
const mirror = (repository, upstream, lagChanges = '0', errorCode = null) => ({
  repository,
  mode: 'mirror',
  upstream,
  sourceRepository: repository,
  phase: 'following',
  errorCode,
  checkedAt: null,
  syncedAt: null,
  lagChanges,
  copiedArtifacts: 0,
  copiedBytes: '0',
});
const stored = (id, name, url, state, seenAt, topology) => ({
  id,
  name,
  url,
  fingerprint: null,
  addedBy: 'admin',
  addedAt: new Date(now - 3600000).toISOString(),
  seenAt: seenAt === null ? null : new Date(seenAt).toISOString(),
  state,
  error: state === 'ok' ? null : state,
  topology,
});

function source(sites, own = topology('Main')) {
  let reads = 0;
  const overview = new FleetOverviewSource(
    {
      list: async () => {
        reads++;
        return sites;
      },
    },
    async () => own,
    {
      name: 'Main',
      version: '1.2.0',
      url: 'https://main.example',
      lagLimit: 1000n,
      now: () => now,
    },
  );
  return { overview, reads: () => reads };
}

test('the overview links a site to the controller and alerts what needs attention', async () => {
  const sites = [
    stored(
      '11111111-1111-4111-8111-111111111111',
      'Branch "east"\nline',
      'https://branch.example',
      'ok',
      now - 1000,
      topology('Branch', [
        mirror('releases', 'https://MAIN.example:443'),
        mirror('vendor', 'https://vendor.example', '5000'),
      ]),
    ),
    stored(
      '22222222-2222-4222-8222-222222222222',
      'Gone',
      'https://gone.example',
      'unreachable',
      now - 600000,
      null,
    ),
    // A row stored by an older release that no longer reads as the contract says.
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Odd',
      state: 'ok',
      topology: { broken: true },
    },
  ];
  const { overview, reads } = source(sites);
  const wire = readFleetOverview(await overview.overview());
  assert.deepEqual(
    wire.links.map((link) => `${link.from}->${link.to}:${link.repository}`),
    [
      'self->11111111-1111-4111-8111-111111111111:releases',
      'external:https://vendor.example->11111111-1111-4111-8111-111111111111:vendor',
    ],
  );
  assert.deepEqual(wire.external, ['https://vendor.example']);
  assert.deepEqual(
    wire.alerts.map((alert) => `${alert.severity}/${alert.kind}/${alert.name}`),
    ['critical/unreachable/Gone', 'critical/invalid/Odd', 'warning/mirror-lag/Branch "east"\nline'],
  );
  assert.equal(wire.alerts[0].since, new Date(now - 600000).toISOString());
  // One reading serves every request of the next five seconds.
  await overview.overview();
  await overview.overview();
  assert.equal(reads(), 1);
});

test('fleet gauges carry hostile site names safely and drop the controller itself', async () => {
  const sites = [
    stored(
      '11111111-1111-4111-8111-111111111111',
      'Branch "east"\\\nline',
      'https://branch.example',
      'ok',
      now - 1000,
      topology('Branch', [mirror('releases', 'https://main.example', '12')]),
    ),
  ];
  const { overview } = source(sites);
  const registry = new MetricsRegistry(3);
  overview.register(registry);
  let failed = 0;
  await overview.refresh(() => failed++);
  assert.equal(failed, 0);
  const text = registry.render();
  assert.match(
    text,
    /arkvory_fleet_site_up\{site="11111111-1111-4111-8111-111111111111",name="Branch \\"east\\"\\\\\\nline"\} 1/,
  );
  assert.match(
    text,
    /arkvory_fleet_mirror_lag_changes\{site="11111111-[^"]*",repository="releases"\} 12/,
  );
  assert.doesNotMatch(text, /site="self"[^\n]*arkvory_fleet_site_up/);
  for (const line of text.split('\n'))
    assert.ok(line === '' || /^(# |[a-z_]+(\{.*\})? -?[0-9.e+]+$)/.test(line), line);
  // A failed reading is a counted collection failure, never stale gauges.
  const broken = new FleetOverviewSource(
    {
      list: async () => {
        throw new Error('database down');
      },
    },
    async () => topology('Main'),
    { name: 'Main', version: '1.2.0', url: null, lagLimit: 1000n, now: () => now + 60000 },
  );
  await broken.refresh(() => failed++);
  assert.equal(failed, 1);
});

test('a silent site keeps its links and lag as last known; alerts use fresh reads only', async () => {
  const lagging = topology('Gone', [mirror('releases', 'https://main.example', '5000')]);
  const sites = [
    stored(
      '22222222-2222-4222-8222-222222222222',
      'Gone',
      'https://gone.example',
      'unreachable',
      now - 600000,
      lagging,
    ),
    // A lag longer than 30 digits does not read as the contract says: the site is invalid.
    stored(
      '44444444-4444-4444-8444-444444444444',
      'Huge',
      'https://huge.example',
      'ok',
      now - 1000,
      topology('Huge', [mirror('vendor', 'https://main.example', '1'.repeat(31))]),
    ),
    // Rows without an id of their own still make one series each.
    { name: 'First broken' },
    { id: 7, name: 'Second broken' },
  ];
  const { overview } = source(sites);
  const wire = readFleetOverview(await overview.overview());
  assert.deepEqual(
    wire.links.map(
      (link) => `${link.from}->${link.to}:${String(link.lagChanges)}:${String(link.stale)}`,
    ),
    ['self->22222222-2222-4222-8222-222222222222:5000:true'],
  );
  assert.deepEqual(
    wire.alerts.map((alert) => `${alert.kind}/${alert.name}`),
    ['invalid/First broken', 'unreachable/Gone', 'invalid/Huge', 'invalid/Second broken'],
  );
  const registry = new MetricsRegistry(3);
  overview.register(registry);
  await overview.refresh(() => assert.fail('the reading failed'));
  const text = registry.render();
  assert.match(
    text,
    /arkvory_fleet_mirror_lag_changes\{site="22222222-[^"]*",repository="releases"\} 5000/,
  );
  assert.match(text, /arkvory_fleet_mirror_lag_alert_changes 1000/);
  assert.match(text, /arkvory_fleet_site_up\{site="unknown:2",name="First broken"\} 0/);
  assert.match(text, /arkvory_fleet_site_up\{site="unknown:3",name="Second broken"\} 0/);
  assert.doesNotMatch(text, /NaN|Inf/);
});

test('an overview from an older controller without link staleness reads as fresh', () => {
  const wire = readFleetOverview({
    generatedAt: new Date(now).toISOString(),
    self: { name: 'Main', version: '1.2.0', url: null },
    alerts: [],
    links: [
      {
        from: 'self',
        to: 'a',
        repository: 'r',
        sourceRepository: 'r',
        mode: 'mirror',
        lagChanges: '1',
        failing: false,
      },
    ],
    external: [],
  });
  assert.equal(wire.links[0].stale, false);
});

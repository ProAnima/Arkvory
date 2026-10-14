import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fleetAlerts,
  fleetLinks,
  siteOrigin,
  UNREACHABLE_GRACE_MS,
} from '../packages/domain/dist/index.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const options = { now, pollMs: 30000, lagLimit: 1000n, version: '1.2.0' };
const report = (extra = {}) => ({
  version: '1.2.0',
  role: 'api',
  writable: true,
  draining: false,
  copies: null,
  required: null,
  singleCopyUntil: null,
  updatesError: null,
  mirrors: [],
  ...extra,
});
const site = (extra = {}) => ({
  id: 'a',
  name: 'Alpha',
  url: 'https://alpha.example',
  state: 'ok',
  addedAt: now - 3600000,
  seenAt: now - 1000,
  report: report(),
  ...extra,
});
const kinds = (alerts) => alerts.map((alert) => `${alert.kind}:${alert.severity}`);

test('one address in one spelling: case, default port, trailing slash and a final dot', () => {
  for (const spelling of [
    'https://Alpha.Example',
    'https://alpha.example:443',
    'https://alpha.example/',
    'https://alpha.example.:0443',
  ])
    assert.equal(siteOrigin(spelling), 'https://alpha.example', spelling);
  assert.equal(siteOrigin('http://127.0.0.1:80'), 'http://127.0.0.1');
  assert.equal(siteOrigin('https://[::1]:8443'), 'https://[::1]:8443');
  assert.equal(siteOrigin('https://alpha.example:8443'), 'https://alpha.example:8443');
  for (const bad of [
    'https://alpha.example/path',
    'https://user@alpha.example',
    'ftp://alpha.example',
    'https://alpha.example:70000',
    'https://alpha.example:0',
    'alpha.example',
    '',
  ])
    assert.equal(siteOrigin(bad), null, bad);
});

test('a healthy fleet raises nothing; one failed read is no alert yet', () => {
  assert.deepEqual(fleetAlerts([site()], options), []);
  const blip = site({ state: 'unreachable', seenAt: now - 40000 });
  assert.deepEqual(fleetAlerts([blip], options), []);
  const down = site({ state: 'unreachable', seenAt: now - UNREACHABLE_GRACE_MS });
  const [alert] = fleetAlerts([down], options);
  assert.equal(alert.kind, 'unreachable');
  assert.equal(alert.since, now - UNREACHABLE_GRACE_MS, 'since the last good answer');
  // Never read since it was added long ago: unreachable, without a since.
  const never = site({ state: 'pending', seenAt: null, report: null, addedAt: now - 600000 });
  assert.deepEqual(kinds(fleetAlerts([never], options)), ['unreachable:critical']);
  assert.equal(fleetAlerts([never], options)[0].since, null);
  // Just added: give the first read its time.
  assert.deepEqual(
    fleetAlerts([site({ state: 'pending', seenAt: null, addedAt: now })], options),
    [],
  );
});

test('an answer from a clock ahead of ours is not fresh forever, nor stale at once', () => {
  const ahead = site({ seenAt: now + 86400000 });
  assert.deepEqual(fleetAlerts([ahead], options), []);
  const silentOk = site({ seenAt: now - 4 * 30000 });
  assert.deepEqual(kinds(fleetAlerts([silentOk], options)), ['stale:warning']);
});

test('trust failures page at once; the last report still tells the rest', () => {
  for (const state of ['certificate', 'revoked', 'refused', 'invalid'])
    assert.ok(kinds(fleetAlerts([site({ state })], options)).includes(`${state}:critical`), state);
});

test('copies, writes, updates and versions', () => {
  const lost = site({ report: report({ copies: 1, required: 2 }) });
  assert.deepEqual(kinds(fleetAlerts([lost], options)), ['copies:critical']);
  const decided = site({ report: report({ copies: 1, required: 2, singleCopyUntil: now + 1000 }) });
  assert.deepEqual(kinds(fleetAlerts([decided], options)), ['single-copy:warning']);
  const expired = site({ report: report({ copies: 1, required: 2, singleCopyUntil: now - 1 }) });
  assert.deepEqual(kinds(fleetAlerts([expired], options)), ['copies:critical']);
  // A draining writer refuses writes on purpose; a read gateway never writes.
  assert.deepEqual(
    fleetAlerts([site({ report: report({ writable: false, draining: true }) })], options),
    [],
  );
  assert.deepEqual(
    fleetAlerts([site({ report: report({ writable: false, role: 'reader' }) })], options),
    [],
  );
  assert.deepEqual(kinds(fleetAlerts([site({ report: report({ writable: false }) })], options)), [
    'not-writable:critical',
  ]);
  assert.deepEqual(
    kinds(
      fleetAlerts(
        [site({ report: report({ updatesError: 'check_failed', version: '1.1.0' }) })],
        options,
      ),
    ),
    ['updates-failed:warning', 'version-skew:info'],
  );
});

test('mirror lag stays exact beyond 2^53; a restored source is no failure', () => {
  const mirror = (lagChanges, errorCode = null) => ({
    repository: 'releases',
    upstream: 'https://alpha.example',
    sourceRepository: 'releases',
    mode: 'mirror',
    lagChanges,
    errorCode,
  });
  const at = (...mirrors) => kinds(fleetAlerts([site({ report: report({ mirrors }) })], options));
  assert.deepEqual(at(mirror('999')), []);
  assert.deepEqual(at(mirror('1000')), ['mirror-lag:warning']);
  // 2^53 + 1 would round down to 2^53 as a number; as a decimal it stays itself.
  const huge = { ...options, lagLimit: 9007199254740993n };
  assert.deepEqual(
    kinds(fleetAlerts([site({ report: report({ mirrors: [mirror('9007199254740992')] }) })], huge)),
    [],
  );
  assert.deepEqual(at(mirror('-5'), mirror('1e9'), mirror(null)), [], 'not a decimal: no lag');
  assert.deepEqual(at(mirror('0', 'mirror_source_behind')), []);
  assert.deepEqual(at(mirror('0', 'mirror_mismatch')), ['mirror-failing:warning']);
});

test('alerts come in a stable order: severity, site name, kind', () => {
  const alerts = fleetAlerts(
    [
      site({ id: 'b', name: 'Beta', report: report({ version: '0.9.0' }) }),
      site({ id: 'a', name: 'Alpha', state: 'revoked' }),
      site({ id: 'c', name: 'alpha', report: report({ updatesError: 'x' }) }),
    ],
    options,
  );
  assert.deepEqual(
    alerts.map((alert) => `${alert.severity}/${alert.name}/${alert.kind}`),
    ['critical/Alpha/revoked', 'warning/alpha/updates-failed', 'info/Beta/version-skew'],
  );
});

test('links follow the source address in any spelling; cycles, self and unknown sources stay', () => {
  const mirror = (repository, upstream) => ({
    repository,
    upstream,
    sourceRepository: repository,
    mode: 'mirror',
    lagChanges: '3',
    errorCode: null,
  });
  const sites = [
    site({
      id: 'self',
      name: 'Main',
      url: 'https://main.example',
      report: report({ mirrors: [mirror('back', 'https://BRANCH.example:443/')] }),
    }),
    site({
      id: 'b',
      name: 'Branch',
      url: 'https://branch.example',
      report: report({
        mirrors: [
          mirror('releases', 'https://main.example'),
          mirror('loop', 'https://branch.example'),
          mirror('vendor', 'https://vendor.example:8443'),
        ],
      }),
    }),
    // Two managed entries at one address: links go to the first, never to both.
    site({ id: 'c', name: 'Copy', url: 'https://main.example/', report: null }),
  ];
  const { links, external } = fleetLinks(sites);
  assert.deepEqual(
    links.map((link) => `${link.from}->${link.to}:${link.repository}`),
    [
      'b->self:back',
      'self->b:releases',
      'b->b:loop',
      'external:https://vendor.example:8443->b:vendor',
    ],
  );
  assert.deepEqual(external, ['https://vendor.example:8443']);
});

test('a fleet of 256 sites with 64 mirrors each evaluates in well under a poll period', () => {
  const sites = Array.from({ length: 256 }, (_, index) =>
    site({
      id: `s${String(index)}`,
      name: `Site ${String(index)}`,
      url: `https://s${String(index)}.example`,
      report: report({
        mirrors: Array.from({ length: 64 }, (_, m) => ({
          repository: `r${String(m)}`,
          upstream: `https://s${String((index + 1) % 256)}.example`,
          sourceRepository: `r${String(m)}`,
          mode: 'mirror',
          lagChanges: String(m * 100),
          errorCode: null,
        })),
      }),
    }),
  );
  const started = performance.now();
  const alerts = fleetAlerts(sites, options);
  const { links } = fleetLinks(sites);
  assert.equal(links.length, 256 * 64);
  assert.equal(alerts.length, 256 * 54, 'lag 1000..6300 on 54 of 64 mirrors');
  assert.ok(performance.now() - started < 1000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialUpdateSnapshot, monitorUpdates } from '../apps/deploy/dist/update-monitor.js';
import { DeploymentCommandTimeout } from '../apps/deploy/dist/process.js';
import { BackupRequired } from '../apps/deploy/dist/backup-guard.js';
import { readUpdateRequest, readUpdateSnapshot } from '@proanima/arkvory-contracts';

const now = '2026-09-26T03:05:00.000Z';
const release = {
  format: 1,
  version: '1.0.0',
  schema: 15,
  commit: 'a'.repeat(40),
  archiveSha256: 'a'.repeat(64),
  setupSha256: 'b'.repeat(64),
};
const state = {
  format: 1,
  mode: 'systemd',
  engine: 'docker',
  automatic: false,
  pin: null,
  current: release,
};
const next = { ...release, version: '1.1.0', archiveSha256: 'c'.repeat(64) };
function fixture(installation = state, candidate = next) {
  const events = [],
    saved = [];
  const port = {
    save: async (value) => {
      saved.push(structuredClone(value));
    },
    resolve: async () => {
      events.push('check');
      return candidate;
    },
    configure: async (automatic) => {
      events.push(['configure', automatic]);
    },
    apply: async (version, hash) => {
      events.push(['apply', version, hash]);
      return { ...installation, current: candidate };
    },
  };
  return { port, events, saved, snapshot: initialUpdateSnapshot(installation, now) };
}
test('notifications check stable releases while automatic installation is disabled', async () => {
  const f = fixture();
  const result = await monitorUpdates(state, f.snapshot, null, now, f.port);
  assert.deepEqual(f.events, ['check']);
  assert.equal(result.latest.version, next.version);
  assert.deepEqual(readUpdateSnapshot(result), result);
  await monitorUpdates(state, result, null, '2026-09-26T04:05:00.000Z', f.port);
  assert.equal(f.events.length, 1);
});
test('automatic update records intent before installation and honors its UTC window and pin', async () => {
  const enabled = { ...state, automatic: true };
  for (const [installation, at, expected] of [
    [enabled, now, true],
    [enabled, '2026-09-26T02:00:00.000Z', false],
    [{ ...enabled, pin: '1.0.0' }, now, false],
  ]) {
    const f = fixture(installation);
    const result = await monitorUpdates(installation, f.snapshot, null, at, f.port);
    assert.equal(f.events.some(Array.isArray), expected);
    if (expected) {
      assert.equal(result.currentVersion, '1.1.0');
      assert.equal(f.saved.at(-2).phase, 'updating');
      assert.equal(f.saved.at(-2).lastAttemptDay, '2026-09-26');
    }
  }
});
test('automatic installation never retries an unsuccessful attempt in the same day', async () => {
  const enabled = { ...state, automatic: true },
    f = fixture(enabled);
  let attempts = 0;
  f.port.apply = async () => {
    attempts++;
    throw Error('failure');
  };
  const failed = await monitorUpdates(enabled, f.snapshot, null, now, f.port);
  assert.equal(failed.error, 'update_failed');
  const rechecked = await monitorUpdates(
    enabled,
    failed,
    { kind: 'check', id: randomUUID(), expectedRevision: failed.revision },
    now,
    f.port,
  );
  await monitorUpdates(enabled, rechecked, null, now, f.port);
  assert.equal(attempts, 1);
});
test('failed release checks are throttled and cannot trigger installation of stale metadata', async () => {
  const enabled = { ...state, automatic: true },
    f = fixture(enabled);
  f.snapshot.latest = { version: '1.1.0', schema: 15, sha256: next.archiveSha256 };
  f.port.resolve = async () => {
    f.events.push('check');
    throw Error('GitHub unavailable');
  };
  const failed = await monitorUpdates(enabled, f.snapshot, null, now, f.port);
  assert.equal(failed.error, 'check_failed');
  await monitorUpdates(enabled, failed, null, now, f.port);
  assert.deepEqual(f.events, ['check']);
});
test('a schema change installs in the window; a refused backup reports maintenance once a day', async () => {
  const enabled = { ...state, automatic: true },
    candidate = { ...next, schema: 16 };
  const f = fixture(enabled, candidate);
  const result = await monitorUpdates(enabled, f.snapshot, null, now, f.port);
  assert.equal(result.error, null);
  assert.equal(result.currentSchema, 16);
  assert.deepEqual(f.events, ['check', ['apply', '1.1.0', next.archiveSha256]]);
  const refused = fixture(enabled, candidate);
  refused.port.apply = async () => {
    refused.events.push('apply');
    throw new BackupRequired('No backup vault is configured');
  };
  const failed = await monitorUpdates(enabled, refused.snapshot, null, now, refused.port);
  assert.equal(failed.error, 'maintenance_required');
  assert.equal(failed.currentVersion, '1.0.0');
  await monitorUpdates(enabled, failed, null, '2026-09-26T03:35:00.000Z', refused.port);
  assert.deepEqual(refused.events, ['check', 'apply'], 'one attempt per day');
});
test('requests use CAS, preserve selected bytes and acknowledge duplicates without side effects', async () => {
  const f = fixture();
  const snapshot = await monitorUpdates(state, f.snapshot, null, now, f.port);
  const request = {
    kind: 'configure',
    id: randomUUID(),
    expectedRevision: snapshot.revision,
    automatic: true,
    hourUTC: 22,
  };
  const configured = await monitorUpdates(state, snapshot, request, now, f.port);
  assert.equal(configured.hourUTC, 22);
  assert.equal(configured.automatic, true);
  const enabled = { ...state, automatic: true };
  await monitorUpdates(enabled, configured, request, now, f.port);
  assert.equal(f.events.filter(Array.isArray).length, 1);
  const conflict = await monitorUpdates(
    enabled,
    configured,
    { ...request, id: randomUUID() },
    now,
    f.port,
  );
  assert.equal(conflict.error, 'conflict');
  const mismatch = await monitorUpdates(
    state,
    snapshot,
    {
      kind: 'apply',
      id: randomUUID(),
      expectedRevision: snapshot.revision,
      version: next.version,
      sha256: 'd'.repeat(64),
    },
    now,
    f.port,
  );
  assert.equal(mismatch.error, 'update_failed');
  assert.equal(
    f.events.some((e) => Array.isArray(e) && e[0] === 'apply'),
    false,
  );
});
test('uncertain process termination reaches installation lock owner without being acknowledged', async () => {
  const f = fixture(),
    failure = new DeploymentCommandTimeout(false);
  const snapshot = await monitorUpdates(state, f.snapshot, null, now, f.port);
  f.port.apply = async () => {
    throw failure;
  };
  await assert.rejects(
    monitorUpdates(
      state,
      snapshot,
      {
        kind: 'apply',
        id: randomUUID(),
        expectedRevision: snapshot.revision,
        version: next.version,
        sha256: next.archiveSha256,
      },
      now,
      f.port,
    ),
    (error) => error === failure,
  );
  assert.equal(f.saved.at(-1).error, 'recovery_required');
  assert.equal(f.saved.at(-1).lastRequestId, null);
});
test('update commands reject shell fields, prereleases and out-of-range policy values', () => {
  const base = { id: randomUUID(), expectedRevision: 0, kind: 'check' };
  assert.deepEqual(readUpdateRequest(base), base);
  for (const patch of [
    { command: 'shell' },
    { expectedRevision: -1 },
    { kind: 'configure', automatic: true, hourUTC: 24 },
    { kind: 'apply', version: '1.0.0-rc1', sha256: next.archiveSha256 },
  ])
    assert.throws(() => readUpdateRequest({ ...base, ...patch }));
});
test('the hub settings reach the snapshot and the console may turn statistics off', async () => {
  const f = fixture();
  const configured = [];
  f.port.configure = async (automatic, statistics) => {
    configured.push([automatic, statistics]);
  };
  const hub = { statistics: true, channel: 'stable' };
  const first = await monitorUpdates(state, f.snapshot, null, now, f.port, hub);
  assert.equal(first.statistics, true);
  assert.equal(first.channel, 'stable');
  // Learning the hub settings is not a change: a request queued before still applies.
  assert.equal(first.revision, f.snapshot.revision);
  const queued = readUpdateRequest({
    kind: 'configure',
    id: randomUUID(),
    expectedRevision: f.snapshot.revision,
    automatic: false,
    hourUTC: 4,
  });
  const fresh = fixture();
  const applied = await monitorUpdates(state, fresh.snapshot, queued, now, fresh.port, hub);
  assert.equal(applied.error, null);
  assert.equal(applied.hourUTC, 4);
  const request = readUpdateRequest({
    kind: 'configure',
    id: randomUUID(),
    expectedRevision: first.revision,
    automatic: false,
    hourUTC: 3,
    statistics: false,
  });
  const next = await monitorUpdates(state, first, request, now, f.port, hub);
  assert.deepEqual(configured, [[false, false]]);
  assert.equal(next.statistics, false);
  assert.deepEqual(readUpdateSnapshot(next), next);
  assert.throws(() => readUpdateRequest({ ...request, statistics: 'off' }));
  // Older consoles omit the field: statistics stay as they are.
  const older = readUpdateRequest(
    JSON.parse(JSON.stringify({ ...request, id: randomUUID(), statistics: undefined })),
  );
  assert.equal('statistics' in older, false);
  // A change on the host invalidates a console form like any other setting.
  const host = await monitorUpdates(state, next, null, now, f.port, {
    statistics: true,
    channel: 'beta',
  });
  assert.ok(host.revision > next.revision);
  assert.equal(host.channel, 'beta');
});

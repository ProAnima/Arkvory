import test from 'node:test';
import assert from 'node:assert/strict';
import { BackupRequired, verifiedBackup } from '../apps/deploy/dist/backup-guard.js';
import { applyMigration, recoveryDirection } from '../apps/deploy/dist/migration-update.js';
import { DeploymentCommandTimeout } from '../apps/deploy/dist/process.js';

const previous = {
  format: 1,
  version: '1.0.0',
  commit: 'a'.repeat(40),
  schema: 15,
  archiveSha256: 'a'.repeat(64),
  setupSha256: 'b'.repeat(64),
};
const next = { ...previous, version: '1.1.0', schema: 16, archiveSha256: 'c'.repeat(64) };
const state = {
  format: 1,
  mode: 'systemd',
  engine: 'docker',
  automatic: true,
  pin: null,
  current: previous,
};
const pointId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

function status(change = {}) {
  return {
    vault: { configured: true, id: 'vault-1', available: true, freeBytes: '1', totalBytes: '2' },
    agent: { online: true, lastSeenAt: null, version: '1.0.0' },
    lastCompleted: { id: 'older' },
    ...change,
  };
}

/** Backup API whose capture completes after `polls` reads and is then verified. */
function api({ current = status(), polls = 2, capture = 'completed', verifyError = null } = {}) {
  const calls = [];
  let reads = 0;
  return {
    calls,
    port: {
      status: async () => current,
      run: async (key) => {
        calls.push(`run ${key}`);
        return { id: jobId, kind: 'capture', state: 'queued' };
      },
      jobs: async () => {
        reads++;
        if (reads === 1) throw new Error('API restarting');
        const done = reads > polls;
        return [{ id: jobId, state: done ? capture : 'running', pointId: done ? pointId : null }];
      },
      points: async () => [
        { id: pointId, snapshotAt: '2026-10-03T00:00:00.000Z', verifiedAt: 'x', verifyError },
      ],
    },
  };
}

function wait() {
  let clock = 0;
  const beats = [];
  return {
    beats,
    intervalMs: 0,
    timeoutMs: 100,
    now: () => (clock += 10),
    beat: async () => {
      beats.push(clock);
    },
  };
}

test('a fresh capture is requested and returned only after its verification', async () => {
  const a = api(),
    w = wait();
  const point = await verifiedBackup(a.port, 'key-1', w);
  assert.deepEqual(point, { pointId, vaultId: 'vault-1', snapshotAt: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(a.calls, ['run key-1']);
  assert(w.beats.length >= 3, 'the heartbeat follows every poll');
});

test('the guard refuses before any change without a usable vault, agent or first copy', async () => {
  for (const [current, reason] of [
    [status({ vault: { configured: false, id: null, available: false } }), /No backup vault/],
    [status({ vault: { configured: true, id: 'v', available: false } }), /unavailable/],
    [status({ agent: { online: false } }), /offline/],
    [status({ lastCompleted: null }), /first backup/],
  ]) {
    const a = api({ current });
    await assert.rejects(verifiedBackup(a.port, 'k', wait()), (error) => {
      assert(error instanceof BackupRequired);
      assert.match(error.message, reason);
      assert.match(error.message, /arkvory upgrade --backup-record/);
      return true;
    });
    assert.deepEqual(a.calls, [], 'no capture was requested');
  }
  const old = api();
  old.port.status = async () => {
    throw new Error('Backup API is unavailable (HTTP 404)');
  };
  await assert.rejects(verifiedBackup(old.port, 'k', wait()), /does not report backups/);
});

test('a failed capture, a damaged point or no progress refuse; a timeout stays unconfirmed', async () => {
  await assert.rejects(
    verifiedBackup(api({ capture: 'failed' }).port, 'k', wait()),
    (error) => error instanceof BackupRequired && /capture failed/.test(error.message),
  );
  await assert.rejects(
    verifiedBackup(api({ verifyError: 'blob_missing' }).port, 'k', wait()),
    /failed verification \(blob_missing\)/,
  );
  await assert.rejects(
    verifiedBackup(api({ polls: 1000 }).port, 'k', wait()),
    /Timed out waiting for the backup capture/,
  );
  const hung = api();
  const failure = new DeploymentCommandTimeout(false);
  hung.port.jobs = async () => {
    throw failure;
  };
  await assert.rejects(verifiedBackup(hung.port, 'k', wait()), (error) => error === failure);
});

function port(fail = '') {
  const events = [];
  let healthCalls = 0;
  return {
    events,
    stage: async () => {
      events.push('stage');
    },
    backup: async () => {
      events.push('backup');
      if (fail === 'backup') throw new BackupRequired('No backup vault is configured');
      return 'backup point p';
    },
    stop: async () => {
      events.push('stop');
    },
    migrate: async (release) => {
      events.push('migrate:' + release.version);
      if (fail === 'migrate') throw Error('constraint violated');
      if (fail === 'migrate-timeout') throw new DeploymentCommandTimeout(false);
    },
    start: async (release) => {
      events.push('start:' + release.version);
    },
    healthy: async () => {
      healthCalls++;
      events.push('health');
      if (fail === 'health' || (fail === 'migrate-refused' && healthCalls === 1))
        throw Error('unhealthy');
    },
    save: async (value) => {
      events.push('save:' + value.current.version);
    },
    journal: async (value) => {
      assert.equal(value.backup, 'backup point p');
      events.push(value.phase);
    },
  };
}

test('a schema update stages and backs up while running, then migrates and starts', async () => {
  const p = port();
  await applyMigration(state, next, p);
  assert.deepEqual(p.events, [
    'stage',
    'backup',
    'prepared',
    'stop',
    'stopped',
    'save:1.1.0',
    'migrating',
    'migrate:1.1.0',
    'migrated',
    'start:1.1.0',
    'health',
    'committed',
  ]);
});

test('without a verified backup nothing stops and nothing is journaled', async () => {
  const p = port('backup');
  await assert.rejects(applyMigration(state, next, p), BackupRequired);
  assert.deepEqual(p.events, ['stage', 'backup']);
});

test('a failed migration restores the previous release on the unchanged schema', async () => {
  const p = port('migrate');
  await assert.rejects(applyMigration(state, next, p), /previous release restored/);
  assert.deepEqual(p.events.slice(7), [
    'migrate:1.1.0',
    'rolling-back',
    'stop',
    'save:1.0.0',
    'start:1.0.0',
    'health',
    'rolled-back',
  ]);
});

test('a start failure after the migration never runs the previous release again', async () => {
  const p = port('health');
  await assert.rejects(applyMigration(state, next, p), /restore backup point p/);
  assert.deepEqual(p.events.slice(-3), ['start:1.1.0', 'health', 'maintenance-required']);
  assert(!p.events.includes('start:1.0.0'));
});

test('an unconfirmed migration keeps its lock and a refused rollback goes forward only', async () => {
  const hung = port('migrate-timeout');
  await assert.rejects(applyMigration(state, next, hung), DeploymentCommandTimeout);
  assert.equal(hung.events.at(-1), 'recovery-required');
  assert(!hung.events.includes('start:1.0.0'));
  // The previous release refuses a schema whose index phase already committed.
  const refused = port('migrate-refused');
  refused.migrate = async () => {
    refused.events.push('migrate');
    throw Error('index build failed');
  };
  await assert.rejects(applyMigration(state, next, refused), /does not start; .*recover/);
  assert.equal(refused.events.at(-1), 'maintenance-required');
});

test('recovery goes back before a migration began and forward from any later phase', () => {
  for (const phase of ['prepared', 'stopped'])
    assert.equal(recoveryDirection(previous, next, phase), 'back');
  for (const phase of [
    'migrating',
    'migrated',
    'rolling-back',
    'maintenance-required',
    'recovery-required',
  ])
    assert.equal(recoveryDirection(previous, next, phase), 'forward', phase);
  // Same schema: the previous release always serves the database.
  const same = { ...next, schema: previous.schema };
  for (const phase of ['stopped', 'rolling-back', 'recovery-required', 'maintenance-required'])
    assert.equal(recoveryDirection(previous, same, phase), 'back');
});

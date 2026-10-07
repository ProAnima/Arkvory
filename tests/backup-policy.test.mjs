import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REQUEST_ATTEMPTS,
  backupFailureCodes,
  backupPermissions,
  backupRequestKinds,
  backupJobViewStates,
  backupWarningCodes,
  backupWarnings,
  grantedBackupPermissions,
  jobViewState,
  parseBackupPlanUpdate,
  parsePinUpdate,
  planRetention,
  requestRetry,
  requireBackupRequestKey,
  retentionReasons,
  verifyDepths,
} from '@proanima/arkvory-domain';
import {
  backupJobKinds,
  backupJobStateNames,
  backupPermissionNames,
  backupRetentionReasonNames,
  backupVerifyDepths,
  backupWarningNames,
  readBackupStatus,
  readBackupJobPage,
  readBackupRetentionPreview,
} from '@proanima/arkvory-contracts';
import { evaluateBackupStatus } from '@proanima/arkvory-application';
import { agentConfig, parseArguments } from '../apps/backup/dist/index.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-02T02:00:00Z');
const point = (index, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  snapshotAt: T0 - index * DAY,
  pinned: false,
  ...extra,
});
const ids = (list) => list.map((entry) => Number(entry.id.slice(-12)));

test('retention keeps the newest point per day, ISO week and month, united', () => {
  const plan = planRetention(
    Array.from({ length: 60 }, (_, index) => point(index)),
    { daily: 7, weekly: 4, monthly: 6 },
    'UTC',
  );
  // Days 0-6; Sundays 5, 12, 19 close earlier weeks; 2 (Sep 30) and 32 (Aug 31) end months.
  assert.deepEqual(ids(plan.keep), [0, 1, 2, 3, 4, 5, 6, 12, 19, 32]);
  assert.deepEqual(plan.keep[0].reasons, ['daily', 'weekly', 'monthly', 'newest']);
  assert.deepEqual(plan.keep.find((entry) => ids([entry])[0] === 32).reasons, ['monthly']);
  assert.equal(plan.delete.length, 50);
  assert.equal(plan.keep.length + plan.delete.length, 60);
});

test('several points of one day keep only the newest; groups are counted per bucket', () => {
  const sameDay = [0, 1, 2].map((hour) => ({
    ...point(0),
    id: `00000000-0000-4000-8000-00000000000${String(hour)}`,
    snapshotAt: T0 + hour * 3_600_000,
  }));
  const plan = planRetention(sameDay, { daily: 3, weekly: 0, monthly: 0 }, 'UTC');
  assert.deepEqual(ids(plan.keep), [2]);
  assert.deepEqual(ids(plan.delete), [1, 0]);
  // Local days of the plan zone: 23:30 UTC is already the next day in Moscow.
  const moscow = planRetention(
    [
      { ...point(1), snapshotAt: Date.parse('2026-10-01T20:30:00Z') },
      { ...point(2), snapshotAt: Date.parse('2026-10-01T21:30:00Z') },
    ],
    { daily: 2, weekly: 0, monthly: 0 },
    'Europe/Moscow',
  );
  assert.equal(moscow.delete.length, 0);
});

test('pinned and newest points survive any policy; at least one point always remains', () => {
  const points = Array.from({ length: 10 }, (_, index) => point(index, { pinned: index === 7 }));
  const plan = planRetention(points, { daily: 0, weekly: 0, monthly: 0 }, 'UTC');
  assert.deepEqual(
    plan.keep.map((entry) => [ids([entry])[0], entry.reasons]),
    [
      [0, ['newest']],
      [7, ['pinned']],
    ],
  );
  assert.deepEqual(planRetention([point(3)], { daily: 0, weekly: 0, monthly: 0 }, 'UTC'), {
    keep: [{ id: point(3).id, reasons: ['newest'] }],
    delete: [],
  });
  assert.deepEqual(planRetention([], { daily: 7, weekly: 4, monthly: 6 }, 'UTC'), {
    keep: [],
    delete: [],
  });
});

test('plan updates report every invalid member with a JSON Pointer and no values', () => {
  const valid = {
    expectedRevision: 3,
    enabled: true,
    hour: 2,
    minute: 30,
    timezone: 'Europe/Moscow',
    retention: { daily: 7, weekly: 4, monthly: 6 },
  };
  assert.deepEqual(parseBackupPlanUpdate(valid), valid);
  const failure = (value) => {
    try {
      parseBackupPlanUpdate(value);
    } catch (error) {
      assert.equal(error.code, 'invalid_input');
      assert.equal(error.reason, 'validation');
      return error.details;
    }
    assert.fail('accepted');
  };
  assert.deepEqual(
    failure({
      ...valid,
      hour: 24,
      minute: 1.5,
      timezone: 'Mars/Base',
      retention: { daily: 400, weekly: -1, extra: 1 },
      secret: 'x',
    }),
    [
      { field: '/secret', problem: 'unknown_field' },
      { field: '/hour', problem: 'range' },
      { field: '/minute', problem: 'type' },
      { field: '/timezone', problem: 'format' },
      { field: '/retention/extra', problem: 'unknown_field' },
      { field: '/retention/monthly', problem: 'required' },
      { field: '/retention/daily', problem: 'range' },
      { field: '/retention/weekly', problem: 'range' },
    ],
  );
  assert.deepEqual(failure({ ...valid, enabled: 'yes', expectedRevision: undefined }), [
    { field: '/expectedRevision', problem: 'required' },
    { field: '/enabled', problem: 'type' },
  ]);
  assert.deepEqual(failure([]), [{ field: '/', problem: 'type' }]);
  assert.equal(parsePinUpdate({ pinned: false }), false);
  assert.throws(() => parsePinUpdate({ pinned: 1 }), { reason: 'validation' });
  assert.equal(requireBackupRequestKey('nightly-2026.10.02:1'), 'nightly-2026.10.02:1');
  for (const key of [undefined, '', 'a b', 'x'.repeat(129), ['a']])
    assert.throws(() => requireBackupRequestKey(key), { code: 'invalid_input' });
});

test('backup permissions belong to administrators and the bootstrap key only', () => {
  const base = { id: 'x', repositories: ['releases'], permissions: ['read', 'write'] };
  assert.deepEqual(
    grantedBackupPermissions({ ...base, administrator: true, credential: 'session' }),
    ['backup.read', 'backup.manage'],
  );
  assert.deepEqual(
    grantedBackupPermissions({ ...base, serviceAdministrator: true, credential: 'file-key' }),
    backupPermissions,
  );
  for (const principal of [
    { ...base, credential: 'file-key' },
    { ...base, credential: 'personal-token', administrator: true },
    { ...base, administrator: true, managed: { keyId: 'k', bindings: [] } },
  ])
    assert.deepEqual(grantedBackupPermissions(principal), []);
});

test('job view states, retries and wire enumerations follow the domain sets', () => {
  assert.equal(jobViewState('queued', null), 'queued');
  assert.equal(jobViewState('running', 'committing'), 'committing');
  assert.equal(jobViewState('running', 'interrupted'), 'running');
  assert.equal(jobViewState('done', 'completed'), 'completed');
  assert.equal(jobViewState(null, 'interrupted'), 'interrupted');
  assert.equal(requestRetry('interrupted', 1), 'requeue');
  assert.equal(requestRetry('busy', MAX_REQUEST_ATTEMPTS - 1), 'requeue');
  assert.equal(requestRetry('busy', MAX_REQUEST_ATTEMPTS), 'fail');
  assert.equal(requestRetry('vault_missing', 1), 'fail');
  for (const code of backupFailureCodes)
    assert.ok(['requeue', 'fail'].includes(requestRetry(code, 1)));
  assert.deepEqual([...backupWarningNames], [...backupWarningCodes]);
  assert.deepEqual([...backupJobKinds], [...backupRequestKinds]);
  assert.deepEqual([...backupJobStateNames], [...backupJobViewStates]);
  assert.deepEqual([...backupRetentionReasonNames], [...retentionReasons]);
  assert.deepEqual([...backupVerifyDepths], [...verifyDepths]);
  assert.deepEqual([...backupPermissionNames], [...backupPermissions]);
});

const facts = (extra = {}) => ({
  now: T0,
  agentSeenAt: T0 - 10_000,
  vault: { configured: true, available: true, freeBytes: 500n, totalBytes: 1000n },
  scheduleEnabled: true,
  newest: { snapshotAt: T0 - 3_600_000, newBytes: 100n },
  lastCaptureFailed: false,
  verifyFailed: false,
  lastDeepVerifiedAt: T0 - DAY,
  ...extra,
});
const codes = (value) => backupWarnings(value).map((warning) => warning.code);

test('warnings are a pure function of status facts with fixed severities', () => {
  assert.deepEqual(codes(facts()), []);
  assert.deepEqual(
    codes(
      facts({
        agentSeenAt: null,
        vault: { configured: false, available: false, freeBytes: null, totalBytes: null },
        scheduleEnabled: false,
        newest: null,
        lastDeepVerifiedAt: null,
      }),
    ),
    ['vault_not_configured', 'agent_offline', 'schedule_disabled', 'no_backup_yet'],
  );
  // Offline after two minutes; vault facts are then unknown and not reported.
  assert.deepEqual(
    codes(facts({ agentSeenAt: T0 - 121_000, vault: { ...facts().vault, available: false } })),
    ['agent_offline'],
  );
  assert.deepEqual(codes(facts({ agentSeenAt: T0 - 120_000 })), []);
  assert.deepEqual(
    codes(facts({ newest: { snapshotAt: T0 - 26 * 3_600_000 - 1, newBytes: 1n } })),
    ['backup_stale'],
  );
  assert.deepEqual(
    codes(facts({ scheduleEnabled: false, newest: { snapshotAt: 0, newBytes: 1n } })),
    ['schedule_disabled'],
  );
  assert.deepEqual(codes(facts({ vault: { ...facts().vault, available: false } })), [
    'vault_unavailable',
  ]);
  // Below 10% free, or less than twice the bytes the newest point added.
  assert.deepEqual(codes(facts({ vault: { ...facts().vault, freeBytes: 99n } })), [
    'vault_low_space',
  ]);
  assert.deepEqual(codes(facts({ newest: { snapshotAt: T0, newBytes: 251n } })), [
    'vault_low_space',
  ]);
  assert.deepEqual(
    codes(facts({ lastCaptureFailed: true, verifyFailed: true, lastDeepVerifiedAt: T0 - 9 * DAY })),
    ['last_run_failed', 'verify_failed', 'never_deep_verified'],
  );
  const severities = Object.fromEntries(
    backupWarnings(facts({ agentSeenAt: null, lastCaptureFailed: true, verifyFailed: true })).map(
      (warning) => [warning.code, warning.severity],
    ),
  );
  assert.deepEqual(severities, {
    agent_offline: 'critical',
    last_run_failed: 'warning',
    verify_failed: 'critical',
  });
});

test('status view and wire readers agree; a stopped agent is offline at once', () => {
  const plan = {
    enabled: true,
    hour: 2,
    minute: 0,
    timezone: 'UTC',
    retention: { daily: 7, weekly: 4, monthly: 6 },
    revision: 2,
    scheduleFrom: T0 - 10 * DAY,
    lastSlotAt: T0,
    updatedAt: T0,
    updatedBy: 'user:admin',
  };
  const agent = {
    active: false,
    seenAt: T0 - 1000,
    version: '1.2.3',
    vaultConfigured: true,
    vaultId: '00000000-0000-4000-8000-0000000000aa',
    vaultAvailable: true,
    vaultEncrypted: true,
    freeBytes: '10',
    totalBytes: '100',
    lastError: null,
  };
  const snapshot = {
    now: T0,
    agent,
    plan,
    newest: null,
    running: null,
    lastCaptureFailed: false,
    verifyFailed: false,
    lastDeepVerifiedAt: null,
  };
  const stopped = evaluateBackupStatus(snapshot);
  assert.equal(stopped.agent.online, false);
  assert.equal(stopped.vault.available, false);
  // The flag is the last known fact, not a guess made from the agent being offline.
  assert.equal(stopped.vault.encrypted, true);
  assert.equal(evaluateBackupStatus({ ...snapshot, agent: null }).vault.encrypted, null);
  assert.equal(stopped.nextRunAt, T0 + DAY);
  const running = evaluateBackupStatus({ ...snapshot, agent: { ...agent, active: true } });
  assert.equal(running.agent.online, true);
  assert.equal(running.vault.available, true);
  assert.deepEqual(
    running.warnings.map((warning) => warning.code),
    ['no_backup_yet'],
  );
  const wire = readBackupStatus({
    vault: {
      configured: true,
      id: agent.vaultId,
      available: true,
      encrypted: false,
      freeBytes: '10',
      totalBytes: '100',
    },
    agent: { online: true, lastSeenAt: '2026-10-02T02:00:00.000Z', version: '1.2.3' },
    plan: { ...plan, scheduleFrom: undefined },
    lastCompleted: null,
    nextRunAt: '2026-10-03T02:00:00.000Z',
    running: null,
    warnings: [{ code: 'no_backup_yet', severity: 'warning' }],
  });
  assert.equal(wire.plan.revision, 2);
  assert.equal(wire.vault.encrypted, false);
  // Additive: a server that predates the field is read as unknown; a non-boolean is refused.
  const { encrypted: _omitted, ...oldVault } = wire.vault;
  assert.equal(readBackupStatus({ ...wire, vault: oldVault }).vault.encrypted, null);
  assert.equal(
    readBackupStatus({ ...wire, vault: { ...oldVault, encrypted: null } }).vault.encrypted,
    null,
  );
  assert.throws(() => readBackupStatus({ ...wire, vault: { ...wire.vault, encrypted: 'yes' } }));
  assert.throws(() => readBackupStatus({ ...wire, warnings: [{ code: 'other', severity: 'x' }] }));
  assert.throws(() => readBackupJobPage({ items: [], next: '../x' }));
  assert.throws(() => readBackupRetentionPreview({ keep: [{ id: 'x', reasons: [] }], delete: [] }));
});

test('the agent command and its environment are strict', () => {
  assert.deepEqual(parseArguments(['agent']), { kind: 'agent' });
  assert.throws(() => parseArguments(['agent', '--vault', 'x']), { code: 'invalid_argument' });
  const source = { ARKVORY_DATABASE_URL: 'postgresql://db/arkvory', ARKVORY_DATA_DIR: '/srv/data' };
  const plain = agentConfig(source);
  assert.deepEqual([plain.vault, plain.bytesPerSecond, plain.pollSeconds], [null, null, 15]);
  const tuned = agentConfig({
    ...source,
    ARKVORY_BACKUP_VAULT: '/mnt/vault',
    ARKVORY_BACKUP_BYTES_PER_SECOND: '104857600',
    ARKVORY_BACKUP_POLL_SECONDS: '5',
  });
  assert.deepEqual(
    [tuned.vault, tuned.bytesPerSecond, tuned.pollSeconds],
    ['/mnt/vault', 104857600, 5],
  );
  for (const [name, value] of [
    ['ARKVORY_BACKUP_BYTES_PER_SECOND', '1000'],
    ['ARKVORY_BACKUP_BYTES_PER_SECOND', '1e9'],
    ['ARKVORY_BACKUP_POLL_SECONDS', '0'],
    ['ARKVORY_BACKUP_POLL_SECONDS', '3601'],
  ])
    assert.throws(() => agentConfig({ ...source, [name]: value }), { code: 'invalid_argument' });
});

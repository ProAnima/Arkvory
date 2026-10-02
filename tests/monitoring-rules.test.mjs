import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { AdmissionQueue, processIdentity } from '@proanima/arkvory-infrastructure';
import { ApiMetrics } from '../apps/api/dist/api-metrics.js';
import { BackupMetrics } from '../apps/api/dist/backup-metrics.js';
import { MirrorMetrics } from '../apps/api/dist/mirror-metrics.js';

/** Every metric the API can expose, including histogram series and optional TLS/job sources. */
async function exposedNames() {
  const metrics = new ApiMetrics({
    identity: processIdentity('api', '1.0.0', 1, 'rules-host'),
    transfers: {
      uploadGate: new AdmissionQueue(1, 1, 1, 1000, 1),
      downloadGate: new AdmissionQueue(1, 1, 1, 1000, 1),
    },
    activeRequests: () => 0,
    diagnostics: { counters: { written: 0, dropped: 0, truncated: 0, oversized: 0 } },
    jobs: { backlog: async () => ({ queued: 0, running: 0, oldestQueuedSeconds: 0 }) },
    backup: new BackupMetrics(
      {
        currentVault: async () => null,
        snapshot: async () => ({
          now: 2000,
          agent: {
            active: true,
            seenAt: 1000,
            version: '1.0.0',
            vaultConfigured: true,
            vaultId: null,
            vaultAvailable: true,
            freeBytes: '1',
            totalBytes: '2',
            lastError: null,
          },
          plan: {
            enabled: true,
            hour: 2,
            minute: 0,
            timezone: 'UTC',
            retention: { daily: 7, weekly: 4, monthly: 6 },
            revision: 1,
            scheduleFrom: 0,
            lastSlotAt: null,
            updatedAt: 0,
            updatedBy: null,
          },
          newest: {
            id: '00000000-0000-4000-8000-000000000001',
            vaultId: '00000000-0000-4000-8000-000000000002',
            snapshotAt: 1000,
            completedAt: 1000,
            blobs: 0,
            contentBytes: '0',
            newBytes: '0',
            tables: 0,
            rows: 0,
            pinned: false,
            verifiedAt: null,
            verifyDepth: null,
            verifyError: null,
            deepVerifiedAt: null,
          },
          running: null,
          lastCaptureFailed: false,
          verifyFailed: false,
          lastDeepVerifiedAt: null,
        }),
      },
      () => 0,
    ),
    mirrors: new MirrorMetrics(
      {
        all: async () => [
          {
            repository: 'releases',
            upstream: 'https://source.example',
            sourceRepository: 'releases',
            state: {
              syncedAt: '2026-10-02T00:00:00.000Z',
              checkedAt: '2026-10-02T00:00:00.000Z',
              errorCode: null,
            },
          },
        ],
      },
      () => 0,
    ),
    now: () => 0,
    startedAtSeconds: 0,
    residentMemory: () => 0,
    tlsNotAfterMs: () => 0,
  });
  const names = new Set();
  for (const [, name, type] of (await metrics.render()).matchAll(/^# TYPE (\S+) (\S+)$/gm)) {
    names.add(name);
    if (type === 'histogram')
      for (const suffix of ['_bucket', '_sum', '_count']) names.add(name + suffix);
  }
  return names;
}

test('alert rules reference only metrics the API exposes and carry severity and guidance', async () => {
  const document = parse(await readFile('deploy/monitoring/arkvory-alerts.yml', 'utf8'));
  const rules = document.groups.flatMap((group) => group.rules);
  assert.ok(rules.length >= 8);
  const names = await exposedNames();
  const alerts = new Set();
  for (const rule of rules) {
    assert.match(rule.alert, /^Arkvory[A-Za-z]+$/);
    assert.ok(!alerts.has(rule.alert), `duplicate alert ${rule.alert}`);
    alerts.add(rule.alert);
    assert.ok(['warning', 'critical'].includes(rule.labels?.severity), rule.alert);
    assert.ok(rule.annotations?.summary && rule.annotations?.description, rule.alert);
    for (const [metric] of String(rule.expr).matchAll(/arkvory_[a-z_]+/g))
      assert.ok(names.has(metric), `${rule.alert} uses unknown metric ${metric}`);
  }
});

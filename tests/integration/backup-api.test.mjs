import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ArkvoryClient, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { setup } from './fixture.mjs';
import { api } from './backup-agent-fixture.mjs';

const routes = [
  ['GET', '/status'],
  ['GET', '/plan'],
  ['PUT', '/plan'],
  ['POST', '/runs'],
  ['GET', '/jobs'],
  ['GET', '/points'],
  ['POST', `/points/${randomUUID()}/verify`],
  ['PUT', `/points/${randomUUID()}/pin`],
  ['GET', '/retention/preview'],
  ['POST', '/retention/apply'],
];
const vaultId = randomUUID();

/** Catalog rows as the agent would write them, for a vault the heartbeat names. */
async function catalogRows(f, count) {
  await f.catalog.pool.query(
    `UPDATE arkvory_backup_agent SET vault_id=$1, vault_configured=true, vault_available=true,
      heartbeat_at=now() WHERE singleton`,
    [vaultId],
  );
  const ids = [];
  for (let index = 0; index < count; index++) {
    const id = randomUUID();
    ids.push(id);
    await f.catalog.pool.query(
      `INSERT INTO arkvory_backup_points(id, vault_id, job_id, snapshot_at, completed_at, blobs,
         content_bytes, new_bytes, tables, rows)
       VALUES ($1, $2, $3, now() - make_interval(days=>$4), now() - make_interval(days=>$4),
         1, 9007199254740993, 5, 28, 40)`,
      [id, vaultId, randomUUID(), index],
    );
  }
  return ids;
}

test('backup routes need the system permissions; repository keys get 403, nobody 401', async (t) => {
  const f = await setup(t);
  for (const [method, url] of routes) {
    const anonymous = await api(f, method, url, { headers: {} });
    assert.equal(anonymous.status, 401, `${method} ${url}`);
    const reader = await api(f, method, url, {
      headers: f.readerHeaders,
      key: 'k',
      ...(method === 'PUT' ? { payload: {} } : {}),
    });
    assert.deepEqual(
      [reader.status, reader.body.code, reader.body.reason],
      [403, 'forbidden', 'permission_missing'],
      `${method} ${url}`,
    );
  }
  const visible = async (headers) => {
    const response = await f.app.inject({
      url: '/api/v1/operations?surface=administration&limit=100',
      headers,
    });
    return response.json().items.filter((item) => item.operationId.includes('Backup'));
  };
  const admin = await visible(f.headers);
  assert.deepEqual(admin.find((item) => item.operationId === 'getBackupStatus').requiredActions, [
    'backup.read',
  ]);
  assert.deepEqual(admin.find((item) => item.operationId === 'requestBackupRun').requiredActions, [
    'backup.manage',
  ]);
  assert.ok(admin.every((item) => item.visibility === 'administrator'));
  assert.deepEqual(await visible(f.readerHeaders), []);
});

test('plan edits are compare-and-swap with field details; status explains a fresh install', async (t) => {
  const f = await setup(t);
  const plan = await api(f, 'GET', '/plan');
  assert.deepEqual(plan.body, {
    enabled: false,
    hour: 2,
    minute: 0,
    timezone: 'UTC',
    retention: { daily: 7, weekly: 4, monthly: 6 },
    revision: 1,
  });
  const head = await f.app.inject({
    method: 'HEAD',
    url: '/api/v1/backup/plan',
    headers: f.headers,
  });
  assert.equal(head.statusCode, 200);
  const { revision, ...fields } = plan.body;
  const update = {
    ...fields,
    enabled: true,
    timezone: 'Europe/Moscow',
    expectedRevision: revision,
  };
  const saved = await api(f, 'PUT', '/plan', { payload: update });
  assert.deepEqual(
    [saved.status, saved.body.revision, saved.body.timezone],
    [200, 2, 'Europe/Moscow'],
  );
  const stale = await api(f, 'PUT', '/plan', { payload: update });
  assert.deepEqual([stale.status, stale.body.reason], [409, 'revision_mismatch']);
  const invalid = await api(f, 'PUT', '/plan', {
    payload: { ...update, expectedRevision: 2, hour: 25, timezone: 'Mars/Base', extra: 1 },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body.details, [
    { field: '/extra', problem: 'unknown_field' },
    { field: '/hour', problem: 'range' },
    { field: '/timezone', problem: 'format' },
  ]);
  assert.equal((await api(f, 'GET', '/plan?x=1')).status, 400);
  const status = (await api(f, 'GET', '/status')).body;
  assert.deepEqual(status.vault, {
    configured: false,
    id: null,
    available: false,
    encrypted: null,
    freeBytes: null,
    totalBytes: null,
  });
  assert.deepEqual(status.agent, { online: false, lastSeenAt: null, version: null });
  assert.equal(status.plan.revision, 2);
  assert.equal(status.lastCompleted, null);
  assert.equal(status.running, null);
  assert.match(status.nextRunAt, /^\d{4}-\d\d-\d\dT2[0-3]:00:00\.000Z$/);
  assert.deepEqual(status.warnings, [
    { code: 'vault_not_configured', severity: 'warning' },
    { code: 'agent_offline', severity: 'critical' },
    { code: 'no_backup_yet', severity: 'warning' },
  ]);
  const metrics = await f.app.inject({ url: '/health/metrics', headers: f.headers });
  assert.match(metrics.body, /^arkvory_backup_warnings\{code="agent_offline"\} 1$/m);
  assert.match(metrics.body, /^arkvory_backup_warnings\{code="backup_stale"\} 0$/m);
  assert.doesNotMatch(metrics.body, /^arkvory_backup_last_success_timestamp_seconds /m);
});

test('commands are idempotent per key, bounded, and verification needs a known point', async (t) => {
  const f = await setup(t);
  const missing = await api(f, 'POST', '/runs');
  assert.deepEqual(
    [missing.status, missing.body.details],
    [400, [{ field: 'Idempotency-Key', problem: 'required' }]],
  );
  const first = await api(f, 'POST', '/runs', { key: 'k-1' });
  assert.deepEqual([first.status, first.body.state], [202, 'queued']);
  assert.equal((await api(f, 'POST', '/runs', { key: 'k-1' })).body.id, first.body.id);
  // The same key names a different command for another kind.
  const retention = await api(f, 'POST', '/retention/apply', { key: 'k-1' });
  assert.notEqual(retention.body.id, first.body.id);
  assert.equal(retention.body.kind, 'retention');
  assert.equal((await api(f, 'POST', `/points/${randomUUID()}/verify`, { key: 'v' })).status, 404);
  assert.equal((await api(f, 'POST', '/points/not-an-id/verify', { key: 'v' })).status, 400);
  const [a, b] = await catalogRows(f, 2);
  const verify = await api(f, 'POST', `/points/${a}/verify`, { key: 'v' });
  assert.deepEqual([verify.status, verify.body.kind], [202, 'verify']);
  const reused = await api(f, 'POST', `/points/${b}/verify`, { key: 'v' });
  assert.deepEqual([reused.status, reused.body.reason], [409, 'idempotency_mismatch']);
  await f.catalog.pool.query(
    `INSERT INTO arkvory_backup_requests(id, kind, idempotency_key, requested_by, state)
     SELECT gen_random_uuid(), 'capture', 'fill-' || n, 'filler', 'queued'
     FROM generate_series(1, 100) n`,
  );
  const full = await api(f, 'POST', '/runs', { key: 'k-2' });
  assert.deepEqual([full.status, full.body.reason], [507, 'queue_full']);
  // A repeat of an accepted key still answers while the queue is full.
  assert.equal((await api(f, 'POST', '/runs', { key: 'k-1' })).status, 202);
});

test('jobs and points pages are newest first, complete and stable; pins and preview follow', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query(
    `INSERT INTO arkvory_backup_requests(id, kind, idempotency_key, requested_by, state,
       created_at, finished_at)
     SELECT gen_random_uuid(), 'retention', 'old-' || n, 'test-writer', 'done',
       now() - make_interval(secs=>n), now() FROM generate_series(1, 120) n`,
  );
  const seen = [];
  let after;
  for (let page = 0; page < 5; page++) {
    const response = await api(f, 'GET', `/jobs?limit=50${after ? `&after=${after}` : ''}`);
    assert.equal(response.status, 200);
    seen.push(...response.body.items);
    after = response.body.next;
    if (!after) break;
  }
  assert.equal(seen.length, 120);
  assert.equal(new Set(seen.map((job) => job.id)).size, 120);
  const starts = seen.map((job) => job.startedAt);
  assert.deepEqual(starts, [...starts].sort().reverse());
  assert.ok(seen.every((job) => job.state === 'completed' && job.kind === 'retention'));
  for (const query of ['limit=0', 'limit=101', 'after=x', 'other=1'])
    assert.equal((await api(f, 'GET', `/jobs?${query}`)).status, 400, query);
  const ids = await catalogRows(f, 12);
  const first = (await api(f, 'GET', '/points?limit=5')).body;
  assert.deepEqual(
    first.items.map((point) => point.id),
    ids.slice(0, 5),
  );
  assert.equal(first.items[0].contentBytes, '9007199254740993');
  const rest = (await api(f, 'GET', `/points?after=${first.next}&limit=100`)).body;
  assert.deepEqual(
    rest.items.map((point) => point.id),
    ids.slice(5),
  );
  assert.equal(rest.next, null);
  const pinned = await api(f, 'PUT', `/points/${ids[11]}/pin`, { payload: { pinned: true } });
  assert.deepEqual([pinned.status, pinned.body.pinned], [200, true]);
  assert.equal(
    (await api(f, 'PUT', `/points/${randomUUID()}/pin`, { payload: { pinned: true } })).status,
    404,
  );
  assert.deepEqual(
    (await api(f, 'PUT', `/points/${ids[0]}/pin`, { payload: { pinned: 'yes' } })).body.details,
    [{ field: '/pinned', problem: 'type' }],
  );
  const preview = (await api(f, 'GET', '/retention/preview')).body;
  assert.deepEqual(preview.keep[0], {
    id: ids[0],
    reasons: ['daily', 'weekly', 'monthly', 'newest'],
  });
  assert.ok(preview.keep.find((entry) => entry.id === ids[11]).reasons.includes('pinned'));
  assert.equal(preview.keep.length + preview.delete.length, 12);
});

test('SDK and arkvoryctl drive the same contract with text, JSON and exit codes', async (t) => {
  const f = await setup(t);
  const server = (await f.listen()) + '/';
  const token = f.headers.authorization.slice(7);
  const reader = f.readerHeaders.authorization.slice(7);
  const client = new ArkvoryClient(server, () => token);
  const plan = await client.backup.plan();
  const { revision, ...fields } = plan;
  const saved = await client.backup.updatePlan({
    ...fields,
    enabled: true,
    expectedRevision: revision,
  });
  assert.equal(saved.revision, 2);
  await assert.rejects(
    client.backup.updatePlan({ ...fields, expectedRevision: revision }),
    (error) => error instanceof ArkvoryHttpError && error.reason === 'revision_mismatch',
  );
  const run = await client.backup.run('sdk-run');
  assert.deepEqual(await client.backup.run('sdk-run'), run);
  assert.equal((await client.backup.applyRetention()).kind, 'retention');
  const jobs = await client.backup.jobs({ limit: 1 });
  assert.equal(jobs.items.length, 1);
  assert.ok(jobs.next);
  assert.equal((await client.backup.jobs({ after: jobs.next })).items[0].id, run.id);
  const [pointId] = await catalogRows(f, 1);
  assert.equal((await client.backup.points()).items[0].id, pointId);
  assert.equal((await client.backup.pin(pointId, true)).pinned, true);
  assert.equal((await client.backup.verify(pointId)).kind, 'verify');
  assert.deepEqual((await client.backup.retentionPreview()).keep[0].reasons.at(-1), 'newest');
  assert.equal((await client.backup.status()).lastCompleted.id, pointId);

  const env = {
    ...process.env,
    ARKVORY_CLI_HOME: join(f.directory, 'cli'),
    ARKVORY_BASE_URL: server,
  };
  delete env.ARKVORY_TOKEN_FILE;
  const cli = async (args, credential = token) => {
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [resolve('apps/cli/dist/main.js'), ...args],
        {
          env: { ...env, ARKVORY_TOKEN: credential },
          windowsHide: true,
          timeout: 30000,
        },
      );
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  // The heartbeat was written above without an owner: the agent counts as offline (critical).
  const status = await cli(['backup', 'status', '--json']);
  assert.equal(status.code, 9, status.stderr);
  assert.equal(JSON.parse(status.stdout).lastCompleted.id, pointId);
  const text = await cli(['backup', 'status', '--lang', 'en']);
  assert.equal(text.code, 9);
  assert.match(text.stdout, /^Agent: offline/m);
  assert.match(text.stdout, /^Plan: enabled, daily 02:00 UTC, keep 7\/4\/6$/m);
  assert.match(text.stdout, /critical agent_offline/);
  const queued = await cli(['backup', 'run', '--json']);
  assert.equal(queued.code, 0, queued.stderr);
  assert.equal(JSON.parse(queued.stdout).kind, 'capture');
  const unpinned = await cli(['backup', 'pin', pointId, '--off', '--json']);
  assert.equal(JSON.parse(unpinned.stdout).pinned, false);
  const points = await cli(['backup', 'points', '--lang', 'ru']);
  assert.match(points.stdout, new RegExp(`${pointId} 8\\.0 PiB не проверено`));
  const listed = await cli(['backup', 'jobs', '--json']);
  assert.ok(JSON.parse(listed.stdout).items.length >= 3);
  const denied = await cli(['backup', 'status', '--json'], reader);
  assert.equal(denied.code, 3);
  assert.equal(JSON.parse(denied.stderr).error.serverCode, 'forbidden');
  assert.equal((await cli(['backup', 'verify'])).code, 2);
  assert.equal(token.length > 0 && !(status.stdout + status.stderr).includes(token), true);
});

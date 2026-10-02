import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BackupFailure, MAX_REQUEST_ATTEMPTS } from '@proanima/arkvory-domain';
import { ApplyBackupRetention, BackupAgent } from '@proanima/arkvory-application';
import { blob, point, sourceId, time, vaultIn } from './backup-vault-helpers.mjs';

const never = { throwIfAborted() {} };
const lease = { owner: randomUUID(), generation: 1, active: true, throwIfAborted() {} };
const DAY = 86_400_000;

/** In-memory agent ports with the semantics of the PostgreSQL adapters. */
function memoryPorts(plan) {
  const requests = [];
  const points = new Map();
  const queue = {
    requests,
    async claim() {
      const request = requests.find((entry) => entry.state === 'queued');
      if (!request) return null;
      request.state = 'running';
      request.attempts++;
      return { ...request };
    },
    async attach(_lease, id, jobId) {
      requests.find((entry) => entry.id === id).jobId = jobId;
    },
    async progress(_lease, id, progress) {
      requests.find((entry) => entry.id === id).progress = progress;
    },
    async finish(_lease, id, outcome) {
      const request = requests.find((entry) => entry.id === id);
      Object.assign(request, {
        state: outcome.failed ? 'failed' : 'done',
        errorCode: outcome.failed,
        pointId: outcome.pointId ?? request.pointId,
      });
    },
    async requeue(_lease, id) {
      requests.find((entry) => entry.id === id).state = 'queued';
    },
    async followUp(_lease, request) {
      if (requests.some((entry) => entry.key === request.key && entry.kind === request.kind))
        return false;
      requests.push({ ...request, state: 'queued', attempts: 0 });
      return true;
    },
  };
  const plans = {
    async read() {
      return { ...plan };
    },
    async consume(_lease, slot, request) {
      if (plan.lastSlotAt !== null && plan.lastSlotAt >= slot) return false;
      plan.lastSlotAt = slot;
      requests.push({
        id: request.id,
        kind: 'capture',
        pointId: null,
        depth: null,
        key: request.key,
        state: 'queued',
        attempts: 0,
      });
      return true;
    },
  };
  const record = (manifest, newBytes) => ({
    id: manifest.pointId,
    vaultId: manifest.vaultId,
    snapshotAt: Date.parse(manifest.snapshot.takenAt),
    completedAt: Date.parse(manifest.completedAt),
    blobs: manifest.inventory.count,
    contentBytes: manifest.inventory.contentBytes,
    newBytes,
    tables: manifest.tables.length,
    rows: 1,
    pinned: false,
    verifiedAt: null,
    verifyDepth: null,
    verifyError: null,
    deepVerifiedAt: null,
    forgotten: false,
  });
  const catalog = {
    points,
    order: [],
    async reconcile(_lease, _vaultId, change) {
      for (const entry of change.added)
        if (!points.has(entry.manifest.pointId))
          points.set(entry.manifest.pointId, record(entry.manifest, entry.newBytes));
      for (const id of change.damaged)
        if (points.has(id)) points.get(id).verifyError = 'manifest_invalid';
      for (const row of points.values())
        if (!change.present.includes(row.id) && !change.damaged.includes(row.id))
          row.forgotten = true;
    },
    async record(_lease, entry) {
      points.set(entry.manifest.pointId, record(entry.manifest, entry.newBytes));
    },
    async verified(_lease, id, result) {
      const row = points.get(id);
      Object.assign(row, {
        verifiedAt: Date.now(),
        verifyDepth: result.depth,
        verifyError: result.error,
      });
      if (result.depth === 'deep' && result.error === null) row.deepVerifiedAt = Date.now();
    },
    async live(vaultId) {
      return [...points.values()].filter((row) => row.vaultId === vaultId && !row.forgotten);
    },
    async known() {
      return new Set(points.keys());
    },
    async forgotten() {
      return new Set([...points.values()].filter((row) => row.forgotten).map((row) => row.id));
    },
    async forget(_lease, _vaultId, id) {
      const row = points.get(id);
      if (!row || row.pinned) return false;
      catalog.order.push(`mark:${id}`);
      row.forgotten = true;
      return true;
    },
  };
  const lock = {
    held: [],
    async shared(action) {
      lock.held.push('shared');
      return action(never);
    },
    async exclusive(action) {
      lock.held.push('exclusive');
      return action(never);
    },
  };
  return { queue, plans, catalog, lock };
}

async function fixture(t, overrides = {}) {
  const { vault, identity } = await vaultIn(t);
  const plan = {
    enabled: true,
    hour: 2,
    minute: 0,
    timezone: 'UTC',
    retention: { daily: 7, weekly: 4, monthly: 6 },
    revision: 1,
    scheduleFrom: Date.parse('2026-10-01T00:00:00Z'),
    lastSlotAt: null,
    updatedAt: 0,
    updatedBy: null,
    ...overrides.plan,
  };
  const ports = memoryPorts(plan);
  const clock = { now: Date.parse('2026-10-02T02:00:05Z') };
  const captures = [];
  const capture = {
    async run(key, started, cancellation) {
      cancellation.throwIfAborted();
      if (overrides.capture) return overrides.capture(key);
      const entry = await blob(vault, 10);
      const manifest = await point(vault, identity, [entry], new Date(clock.now).toISOString());
      started(manifest.jobId);
      captures.push(key);
      return { pointId: manifest.pointId, jobId: manifest.jobId, copiedBytes: '10' };
    },
  };
  const events = [];
  const agent = new BackupAgent({
    queue: ports.queue,
    plan: ports.plans,
    catalog: ports.catalog,
    vault,
    lock: ports.lock,
    capture,
    sourceInstanceId: sourceId,
    clock: () => clock.now,
    next: () => randomUUID(),
    events: (event) => events.push(event),
  });
  const drain = async () => {
    for (let index = 0; index < 20; index++)
      if ((await agent.step(lease, never)) === 'idle') return;
    assert.fail('agent never became idle');
  };
  return { agent, ports, plan, clock, captures, events, vault, identity, drain };
}

test('a due slot runs once, then verification and retention follow as their own jobs', async (t) => {
  const f = await fixture(t);
  await f.drain();
  const kinds = f.ports.queue.requests.map((request) => [
    request.kind,
    request.depth,
    request.state,
  ]);
  assert.deepEqual(kinds, [
    ['capture', null, 'done'],
    ['verify', 'structural', 'done'],
    ['retention', null, 'done'],
    // The first point has never been read in full: a deep verification follows at once.
    ['verify', 'deep', 'done'],
  ]);
  assert.equal(f.captures.length, 1);
  assert.equal(f.plan.lastSlotAt, Date.parse('2026-10-02T02:00:00Z'));
  const [captured] = f.ports.queue.requests;
  assert.equal(captured.key, 'schedule:2026-10-02T02:00:00.000Z');
  assert.ok(captured.jobId);
  const row = f.ports.catalog.points.get(captured.pointId);
  assert.equal(row.newBytes, '10');
  assert.equal(row.verifyDepth, 'deep');
  assert.equal(row.verifyError, null);
  // Idle steps neither repeat the slot nor the weekly deep verification.
  await f.drain();
  assert.equal(f.ports.queue.requests.length, 4);
  // After two days of downtime exactly one catch-up capture runs.
  f.clock.now += 2 * DAY;
  await f.drain();
  assert.equal(f.captures.length, 2);
  assert.equal(f.plan.lastSlotAt, Date.parse('2026-10-04T02:00:00Z'));
});

test('an interrupted request is queued again and stops after its attempt budget', async (t) => {
  let stop = true;
  const f = await fixture(t, {
    plan: { enabled: false },
    capture: () => {
      throw new BackupFailure(stop ? 'interrupted' : 'vault_full', 'test');
    },
  });
  f.ports.queue.requests.push({
    id: randomUUID(),
    kind: 'capture',
    pointId: null,
    depth: null,
    key: 'k',
    state: 'queued',
    attempts: 0,
  });
  assert.equal(await f.agent.step(lease, never), 'idle');
  assert.equal(f.ports.queue.requests[0].state, 'queued');
  assert.equal(f.events.at(-1).code, 'request.requeued');
  stop = false;
  await f.agent.step(lease, never);
  assert.deepEqual(
    [f.ports.queue.requests[0].state, f.ports.queue.requests[0].errorCode],
    ['failed', 'vault_full'],
  );
  // An agent that kept dying with a request stops claiming it beyond the budget.
  f.ports.queue.requests.push({
    id: randomUUID(),
    kind: 'verify',
    pointId: randomUUID(),
    depth: 'deep',
    key: 'v',
    state: 'queued',
    attempts: MAX_REQUEST_ATTEMPTS,
  });
  await f.agent.step(lease, never);
  assert.equal(f.ports.queue.requests[1].errorCode, 'attempts_exhausted');
});

test('without a vault every request fails vault_missing and nothing is scheduled', async (t) => {
  const f = await fixture(t);
  const agent = new BackupAgent({
    queue: f.ports.queue,
    plan: f.ports.plans,
    catalog: f.ports.catalog,
    vault: null,
    lock: f.ports.lock,
    capture: { run: () => assert.fail('no capture without a vault') },
    sourceInstanceId: sourceId,
    clock: () => f.clock.now,
    next: () => randomUUID(),
  });
  f.ports.queue.requests.push({
    id: randomUUID(),
    kind: 'retention',
    pointId: null,
    depth: null,
    key: 'r',
    state: 'queued',
    attempts: 0,
  });
  await agent.step(lease, never);
  assert.equal(f.ports.queue.requests[0].errorCode, 'vault_missing');
  assert.equal(await agent.step(lease, never), 'idle');
  assert.equal(f.plan.lastSlotAt, null);
});

test('retention keeps pins, the newest and damaged points, forgets the rest, then prunes', async (t) => {
  const f = await fixture(t, { plan: { retention: { daily: 1, weekly: 0, monthly: 0 } } });
  const entries = [];
  const manifests = [];
  for (let day = 1; day <= 5; day++) {
    const entry = await blob(f.vault, 16);
    entries.push(entry);
    manifests.push(await point(f.vault, f.identity, [entry], time(0, day)));
  }
  const foreign = await point(f.vault, f.identity, [entries[0]], time(0, 6), randomUUID());
  await f.agent.reconcile(lease, never);
  assert.equal(f.ports.catalog.points.size, 5, 'points of another source are not cataloged');
  f.ports.catalog.points.get(manifests[1].pointId).pinned = true;
  f.ports.catalog.points.get(manifests[2].pointId).verifyError = 'blob_mismatch';
  const retention = new ApplyBackupRetention({
    vault: f.vault,
    catalog: f.ports.catalog,
    plan: f.ports.plans,
    lock: f.ports.lock,
    sourceInstanceId: sourceId,
  });
  const outcome = await retention.run(lease, never);
  assert.deepEqual(outcome, { forgotten: 2, blobs: 1, bytes: '16' });
  const live = (await f.vault.listing()).committed.map((manifest) => manifest.pointId).sort();
  assert.deepEqual(
    live,
    [manifests[1], manifests[2], manifests[4], foreign].map((m) => m.pointId).sort(),
  );
  // Newest first; each catalog mark precedes the vault change of its point.
  assert.deepEqual(f.ports.catalog.order, [
    `mark:${manifests[3].pointId}`,
    `mark:${manifests[0].pointId}`,
  ]);
  // entries[0] is still listed by the foreign point; entries[3] had no other reference.
  assert.equal(await f.vault.hasBlob(entries[0]), true);
  assert.equal(await f.vault.hasBlob(entries[3]), false);
  assert.ok(f.ports.lock.held.includes('exclusive'));
});

test('a crash between the catalog mark and the vault is completed by the next apply', async (t) => {
  const f = await fixture(t, { plan: { retention: { daily: 1, weekly: 0, monthly: 0 } } });
  const old = await blob(f.vault, 8);
  const first = await point(f.vault, f.identity, [old], time(0, 1));
  await point(f.vault, f.identity, [await blob(f.vault, 8)], time(0, 2));
  await f.agent.reconcile(lease, never);
  let crash = true;
  const vault = new Proxy(f.vault, {
    get(target, name) {
      if (name === 'forget')
        return async (id) => {
          if (crash) throw new BackupFailure('unavailable', 'simulated crash');
          return target.forget(id);
        };
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const retention = new ApplyBackupRetention({
    vault,
    catalog: f.ports.catalog,
    plan: f.ports.plans,
    lock: f.ports.lock,
    sourceInstanceId: sourceId,
  });
  await assert.rejects(retention.run(lease, never), { code: 'unavailable' });
  // The mark stays; the point still exists in the vault and nothing was pruned.
  assert.equal(f.ports.catalog.points.get(first.pointId).forgotten, true);
  assert.ok(await f.vault.point(first.pointId));
  assert.equal(await f.vault.hasBlob(old), true);
  crash = false;
  assert.deepEqual(await retention.run(lease, never), { forgotten: 1, blobs: 1, bytes: '8' });
  assert.equal(await f.vault.point(first.pointId), null);
  assert.deepEqual(await retention.run(lease, never), { forgotten: 0, blobs: 0, bytes: '0' });
});

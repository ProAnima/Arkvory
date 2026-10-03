import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import { ApplyBackupRetention, VerifyPoint } from '@proanima/arkvory-application';
import {
  FileVault,
  PostgresAgentLease,
  PostgresBackupCatalog,
  PostgresBackupPlan,
  PostgresBackupRequests,
  PostgresVaultLock,
} from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { capture, newVault, publish, retire } from './backup-fixture.mjs';
import {
  agentRow,
  api,
  eventually,
  requests,
  savePlan,
  startAgent,
} from './backup-agent-fixture.mjs';

const never = { throwIfAborted() {} };
const facts = {
  vaultConfigured: false,
  vaultId: null,
  vaultAvailable: false,
  freeBytes: null,
  totalBytes: null,
  lastError: null,
};
/** No request is open and at least `count` exist (follow-ups are queued between steps). */
/** One snapshot of all requests: two queries could miss a follow-up queued between them. */
const settled = async (f, count = 1) => {
  const rows = await requests(f);
  return rows.length >= count && rows.every((row) => !['queued', 'running'].includes(row.state));
};

test('one agent holds the lease; a standby takes over and a fenced owner cannot write', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  const first = randomUUID();
  const second = randomUUID();
  const a = startAgent(f, vault, { owner: first });
  let b;
  try {
    const held = await eventually(async () => {
      const row = await agentRow(f);
      return row.owner === first && row.vault_available ? row : null;
    }, 'first agent lease');
    assert.equal(held.version, '9.9.9');
    assert.ok(BigInt(held.vault_free_bytes) > 0n);
    b = startAgent(f, vault, { owner: second });
    await eventually(() => b.has('backup.agent.standby'), 'standby');
    assert.equal((await agentRow(f)).owner, first);
    await a.stop();
    const taken = await eventually(async () => {
      const row = await agentRow(f);
      return row.owner === second ? row : null;
    }, 'takeover after release');
    assert.equal(taken.generation, held.generation + 1);
    // Every agent write is fenced by owner and generation, not only by expiry.
    const stale = { owner: first, generation: held.generation, active: true, throwIfAborted() {} };
    await assert.rejects(new PostgresBackupRequests(f.catalog.pool).claim(stale), {
      code: 'lease_lost',
    });
    await assert.rejects(
      new PostgresBackupPlan(f.catalog.pool).consume(stale, Date.now(), {
        id: randomUUID(),
        key: 'schedule:stale',
        revision: 1,
      }),
      { code: 'lease_lost' },
    );
    await b.stop();
    // A crashed owner is not released: a standby waits for the lease to expire.
    const leases = new PostgresAgentLease(f.catalog.pool, {
      owner: randomUUID(),
      leaseSeconds: 3,
      version: 'crashed',
    });
    const crashed = await leases.acquire(async () => facts);
    await crashed.close();
    b = startAgent(f, vault, { owner: second });
    await eventually(() => b.has('backup.agent.standby'), 'standby behind a crashed owner');
    const recovered = await eventually(async () => {
      const row = await agentRow(f);
      return row.owner === second ? row : null;
    }, 'takeover after expiry');
    assert.equal(recovered.generation, crashed.generation + 1);
  } finally {
    await a.stop();
    await b?.stop();
  }
});

test('a scheduled slot captures once; downtime gives one catch-up and nextRunAt follows slots', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  await publish(f);
  const slot = new Date(Math.floor((Date.now() + 3 * 60_000) / 60_000) * 60_000);
  await savePlan(f, {
    enabled: true,
    hour: slot.getUTCHours(),
    minute: slot.getUTCMinutes(),
    timezone: 'UTC',
  });
  const clock = { now: slot.getTime() + 30_000 };
  const agent = startAgent(f, vault, { clock: () => clock.now });
  try {
    await eventually(() => settled(f, 4), 'scheduled capture and its follow-ups');
    const scheduled = () => requests(f, "kind='capture' AND requested_by='agent:backup'");
    assert.deepEqual(
      (await scheduled()).map((row) => [row.idempotency_key, row.state]),
      [[`schedule:${slot.toISOString()}`, 'done']],
    );
    assert.deepEqual(
      (await requests(f, "kind<>'capture'")).map((row) => [row.kind, row.depth, row.state]),
      [
        ['verify', 'structural', 'done'],
        ['retention', null, 'done'],
        ['verify', 'deep', 'done'],
      ],
    );
    // Further polls never repeat the slot.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal((await scheduled()).length, 1);
    const status = (await api(f, 'GET', '/status')).body;
    assert.equal(status.agent.online, true);
    assert.equal(status.nextRunAt, new Date(slot.getTime() + 86_400_000).toISOString());
    assert.equal(status.lastCompleted.verifyDepth, 'deep');
    // vault_low_space reports the real volume of the temporary vault (below 10% free on a full
    // workstation disk); the warning rules themselves are unit-tested with fixed numbers.
    assert.deepEqual(
      status.warnings.filter((warning) => warning.code !== 'vault_low_space'),
      [],
    );
    // Three days later: exactly one catch-up capture, for the latest missed slot.
    clock.now += 3 * 86_400_000;
    await eventually(async () => (await scheduled()).length === 2 && settled(f), 'catch-up');
    assert.equal(
      (await scheduled())[1].idempotency_key,
      `schedule:${new Date(slot.getTime() + 3 * 86_400_000).toISOString()}`,
    );
  } finally {
    await agent.stop();
  }
});

test('run-now is idempotent per key and the agent reports progress, points and verification', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  const items = [await publish(f), await publish(f)];
  const once = await api(f, 'POST', '/runs', { key: 'now-1' });
  const again = await api(f, 'POST', '/runs', { key: 'now-1' });
  const other = await api(f, 'POST', '/runs', { key: 'now-2' });
  assert.deepEqual([once.status, once.body.kind, once.body.state], [202, 'capture', 'queued']);
  assert.equal(again.body.id, once.body.id);
  assert.notEqual(other.body.id, once.body.id);
  const agent = startAgent(f, vault);
  try {
    await eventually(() => settled(f, 7), 'two captures and follow-ups');
    const jobs = (await api(f, 'GET', '/jobs?limit=100')).body.items;
    const captures = jobs.filter((job) => job.kind === 'capture');
    assert.deepEqual(captures.map((job) => job.id).sort(), [once.body.id, other.body.id].sort());
    const total = String(items.reduce((sum, item) => sum + item.bytes.length, 0));
    for (const job of captures) {
      assert.equal(job.state, 'completed');
      assert.equal(job.phase, 'done');
      assert.deepEqual(job.progress, {
        bytesCopied: total,
        bytesTotal: total,
        blobsCopied: 2,
        blobsTotal: 2,
      });
      assert.ok(job.pointId);
    }
    assert.equal((await api(f, 'POST', '/runs', { key: 'now-1' })).body.state, 'completed');
    // Retention after the second capture keeps one point per day: the newest, which reused all
    // content of the first (its catalog row keeps the exact bytes the first capture copied).
    const points = (await api(f, 'GET', '/points')).body.items;
    const [first, second] = captures.sort((x, y) => (x.startedAt < y.startedAt ? -1 : 1));
    assert.deepEqual(
      points.map((point) => [point.id, point.newBytes]),
      [[second.pointId, '0']],
    );
    const forgotten = await f.catalog.pool.query(
      'SELECT new_bytes::text, forgotten_at IS NOT NULL AS gone FROM arkvory_backup_points WHERE id=$1',
      [first.pointId],
    );
    assert.deepEqual(forgotten.rows, [{ new_bytes: total, gone: true }]);
    const verify = await api(f, 'POST', `/points/${points[0].id}/verify`, { key: 'check' });
    assert.equal(verify.status, 202);
    await eventually(() => settled(f, 8), 'deep verification');
    const checked = (await api(f, 'GET', '/points')).body.items.find((p) => p.id === points[0].id);
    assert.deepEqual([checked.verifyDepth, checked.verifyError], ['deep', null]);
    assert.ok(agent.has('backup.request.done'));
  } finally {
    await agent.stop();
  }
});

test('retention apply forgets points outside the policy and prunes only unreferenced content', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  const a = await publish(f);
  const p1 = await capture(f, vault, 'p1');
  await retire(f, [a.id]);
  const b = await publish(f);
  const p2 = await capture(f, vault, 'p2');
  const c = await publish(f);
  const p3 = await capture(f, vault, 'p3');
  await savePlan(f, { retention: { daily: 0, weekly: 0, monthly: 0 } });
  const agent = startAgent(f, vault);
  try {
    await eventually(() => agent.has('backup.catalog.reconciled'), 'catalog rebuild');
    const pinned = await api(f, 'PUT', `/points/${p2.pointId}/pin`, { payload: { pinned: true } });
    assert.equal(pinned.body.pinned, true);
    const preview = (await api(f, 'GET', '/retention/preview')).body;
    assert.deepEqual(preview, {
      keep: [
        { id: p3.pointId, reasons: ['newest'] },
        { id: p2.pointId, reasons: ['pinned'] },
      ],
      delete: [{ id: p1.pointId }],
    });
    const applied = await api(f, 'POST', '/retention/apply', { key: 'apply-1' });
    assert.equal(applied.status, 202);
    await eventually(() => settled(f), 'retention');
    const job = (await api(f, 'GET', '/jobs')).body.items.find((j) => j.id === applied.body.id);
    assert.equal(job.state, 'completed');
    assert.equal(job.progress.blobsCopied, 1);
    const live = (await api(f, 'GET', '/points')).body.items.map((point) => point.id);
    assert.deepEqual(live, [p3.pointId, p2.pointId]);
    const files = await FileVault.open(vault);
    const size = (item) => ({ id: item.id, size: item.bytes.length, sha256: '0'.repeat(64) });
    assert.equal(await files.hasBlob(size(a)), false, 'content only p1 listed is pruned');
    for (const item of [b, c]) assert.equal(await files.hasBlob(size(item)), true);
    assert.equal(await files.point(p1.pointId), null);
    const verified = await new VerifyPoint(files).run({ deep: true }, never);
    assert.deepEqual(
      verified.map((result) => result.ok),
      [true, true],
    );
    // Even a policy of zero never deletes the last completed point.
    const again = await api(f, 'POST', '/retention/apply', { key: 'apply-2' });
    await eventually(() => settled(f), 'second retention');
    assert.equal((await api(f, 'GET', `/jobs`)).body.items[0].id, again.body.id);
    assert.deepEqual(
      (await api(f, 'GET', '/points')).body.items.map((point) => point.id),
      [p3.pointId, p2.pointId],
    );
  } finally {
    await agent.stop();
  }
});

test('a retention apply that crashes mid-forget is completed by the next one', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  await publish(f);
  const old = await capture(f, vault, 'old');
  await publish(f);
  const kept = await capture(f, vault, 'kept');
  await savePlan(f, { retention: { daily: 0, weekly: 0, monthly: 0 } });
  const agent = startAgent(f, vault);
  await eventually(() => agent.has('backup.catalog.reconciled'), 'catalog rebuild');
  await agent.stop();
  const pool = f.catalog.pool;
  const leases = new PostgresAgentLease(pool, {
    owner: randomUUID(),
    leaseSeconds: 60,
    version: 't',
  });
  const lease = await leases.acquire(async () => facts);
  try {
    const files = await FileVault.open(vault);
    let crash = true;
    // The process dies after COMMITTED is gone, before the directory is removed.
    const crashing = new Proxy(files, {
      get(target, name) {
        if (name === 'forget')
          return async (pointId) => {
            if (!crash) return target.forget(pointId);
            await unlink(join(vault, 'points', pointId, 'COMMITTED'));
            throw new BackupFailure('unavailable', 'simulated crash');
          };
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const { sourceInstanceId } = await files.point(old.pointId);
    const retention = (vaultPort) =>
      new ApplyBackupRetention({
        vault: vaultPort,
        catalog: new PostgresBackupCatalog(pool),
        plan: new PostgresBackupPlan(pool),
        lock: new PostgresVaultLock(pool),
        sourceInstanceId,
      });
    await assert.rejects(retention(crashing).run(lease, never), { code: 'unavailable' });
    const listing = await files.listing();
    assert.deepEqual(listing.uncommitted, [old.pointId]);
    crash = false;
    const outcome = await retention(files).run(lease, never);
    assert.equal(outcome.forgotten, 1);
    assert.deepEqual(
      (await files.listing()).committed.map((m) => m.pointId),
      [kept.pointId],
    );
    assert.deepEqual((await files.listing()).uncommitted, []);
    assert.deepEqual(await retention(files).run(lease, never), {
      forgotten: 0,
      blobs: 0,
      bytes: '0',
    });
  } finally {
    await leases.release(lease);
  }
});

test('the catalog is rebuilt from the vault: estimates, vanished and damaged points', async (t) => {
  const f = await setup(t);
  const { path: vault } = await newVault(t);
  const first = await publish(f);
  const p1 = await capture(f, vault, 'p1');
  const second = await publish(f);
  const p2 = await capture(f, vault, 'p2');
  const p3 = await capture(f, vault, 'p3');
  let agent = startAgent(f, vault);
  try {
    await eventually(() => agent.has('backup.catalog.reconciled'), 'catalog rebuild');
    const byId = Object.fromEntries(
      (await api(f, 'GET', '/points')).body.items.map((point) => [point.id, point]),
    );
    assert.equal(byId[p1.pointId].newBytes, String(first.bytes.length));
    assert.equal(byId[p2.pointId].newBytes, String(second.bytes.length));
    assert.equal(byId[p3.pointId].newBytes, '0');
    await agent.stop();
    await rm(join(vault, 'points', p1.pointId), { recursive: true });
    await writeFile(join(vault, 'points', p2.pointId, 'manifest.json'), '{}');
    agent = startAgent(f, vault);
    await eventually(() => agent.has('backup.catalog.reconciled'), 'second rebuild');
    const points = (await api(f, 'GET', '/points')).body.items;
    assert.deepEqual(
      points.map((point) => [point.id, point.verifyError]),
      [
        [p3.pointId, null],
        [p2.pointId, 'manifest_invalid'],
      ],
    );
    const codes = (await api(f, 'GET', '/status')).body.warnings.map((warning) => warning.code);
    assert.ok(codes.includes('verify_failed'));
  } finally {
    await agent.stop();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresAgentLease, migrate } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { agentRow, api } from './backup-agent-fixture.mjs';

const vaultId = randomUUID();
const facts = (vaultEncrypted) => ({
  vaultConfigured: true,
  vaultId,
  vaultAvailable: true,
  vaultEncrypted,
  freeBytes: 10n,
  totalBytes: 100n,
  lastError: null,
});
const lease = (f) =>
  new PostgresAgentLease(f.catalog.pool, { owner: randomUUID(), leaseSeconds: 60, version: 't' });
const encrypted = async (f) => (await api(f, 'GET', '/status')).body.vault.encrypted;

test('the heartbeat stores the encryption flag and the status API reports it', async (t) => {
  const f = await setup(t);
  assert.equal((await agentRow(f)).vault_encrypted, null, 'unknown before any heartbeat');
  assert.equal(await encrypted(f), null);
  const leases = lease(f);
  for (const flag of [true, false, null]) {
    const held = await leases.acquire(async () => facts(flag));
    assert.ok(held);
    try {
      assert.equal((await agentRow(f)).vault_encrypted, flag);
      assert.equal(await encrypted(f), flag);
    } finally {
      await leases.release(held);
    }
  }
});

test('a heartbeat that renews the lease updates the flag', async (t) => {
  const f = await setup(t);
  let flag = false;
  const leases = new PostgresAgentLease(f.catalog.pool, {
    owner: randomUUID(),
    leaseSeconds: 2,
    version: 't',
  });
  const held = await leases.acquire(async () => facts(flag));
  try {
    assert.equal(await encrypted(f), false);
    flag = true;
    const deadline = Date.now() + 15000;
    while ((await agentRow(f)).vault_encrypted !== true) {
      if (Date.now() > deadline) throw new Error('The renewal never stored the flag');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await encrypted(f), true);
  } finally {
    await leases.release(held);
  }
});

test('a heartbeat of an agent without the field reads as unknown, and offline keeps the last flag', async (t) => {
  const f = await setup(t);
  // The statement of a release that predates the column: it never names vault_encrypted.
  await f.catalog.pool.query(
    `UPDATE arkvory_backup_agent SET owner=$1, lease_until=now()+interval '1 minute',
      heartbeat_at=now(), vault_configured=true, vault_id=$2, vault_available=true
     WHERE singleton`,
    [randomUUID(), vaultId],
  );
  const old = (await api(f, 'GET', '/status')).body;
  assert.deepEqual([old.vault.available, old.vault.encrypted], [true, null]);
  await f.catalog.pool.query('UPDATE arkvory_backup_agent SET vault_encrypted=false');
  await f.catalog.pool.query("UPDATE arkvory_backup_agent SET lease_until=now()-interval '1 s'");
  const stale = (await api(f, 'GET', '/status')).body;
  assert.equal(stale.vault.encrypted, false);
});

test('migration 34 is additive and can run again', async (t) => {
  const f = await setup(t);
  const pool = f.catalog.pool;
  await pool.query('DELETE FROM arkvory_migrations WHERE version=34');
  await pool.query('UPDATE arkvory_backup_agent SET vault_encrypted=true');
  await migrate(pool);
  assert.equal((await agentRow(f)).vault_encrypted, true, 'the stored flag survives');
  const column = await pool.query(
    `SELECT is_nullable, data_type FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name='arkvory_backup_agent'
       AND column_name='vault_encrypted'`,
  );
  assert.deepEqual(column.rows, [{ is_nullable: 'YES', data_type: 'boolean' }]);
});

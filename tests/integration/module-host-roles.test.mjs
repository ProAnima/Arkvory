import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  migrate,
  ModuleUnlinkAdmission,
  PostgresContentPins,
  PostgresModuleCursors,
  ModuleChangeFeed,
  PostgresEventLog,
} from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { publish } from './backup-fixture.mjs';

test('module cleanup protects every active reader, including a different upload sharing chunks', async (t) => {
  const f = await setup(t);
  const pins = new PostgresContentPins(f.catalog.sessions);
  t.after(() => pins.close());
  const admission = new ModuleUnlinkAdmission(f.catalog.sessions);
  const read = await pins.acquire(randomUUID());
  await assert.rejects(
    admission.run(async () => assert.fail('must not unlink')),
    { code: 'busy' },
  );
  await read.release();
  await admission.run(async (check) => {
    check();
    await assert.rejects(pins.acquire(randomUUID()), { code: 'busy' });
  });
  const after = await pins.acquire(randomUUID());
  await after.release();
});

test('module cleanup refuses a pin on ANY upload and a closed capture barrier', async (t) => {
  const f = await setup(t);
  const blob = await publish(f);
  const job = randomUUID();
  await f.catalog.pool.query(
    `INSERT INTO arkvory_backup_jobs
    (id,kind,state,phase,idempotency_key,vault_id,point_id) VALUES($1,'capture','completed','done',$1,$2,$3)`,
    [job, randomUUID(), randomUUID()],
  );
  const admission = new ModuleUnlinkAdmission(f.catalog.sessions);
  await f.catalog.pool.query('INSERT INTO arkvory_backup_pins(upload_id,job_id) VALUES($1,$2)', [
    blob.id,
    job,
  ]);
  await assert.rejects(
    admission.run(async () => assert.fail('foreign upload pin must protect shared chunk')),
    { code: 'busy' },
  );
  await f.catalog.pool.query('DELETE FROM arkvory_backup_pins WHERE job_id=$1', [job]);
  await f.catalog.pool.query(
    "UPDATE arkvory_backup_barrier SET state='closed',job_id=$1,generation=1",
    [job],
  );
  await assert.rejects(
    admission.run(async () => assert.fail('closed barrier')),
    { code: 'busy' },
  );
  await f.catalog.pool.query(
    "UPDATE arkvory_backup_barrier SET state='open',job_id=NULL,generation=NULL",
  );
  await admission.run(async (check) => check());
});

test('module cursor CAS fences stale acknowledgements, with isolated module and consumer keys', async (t) => {
  const f = await setup(t);
  const cursors = new PostgresModuleCursors(f.catalog.pool);
  const first = await cursors.read('signed-index', 'build');
  const stale = await cursors.read('signed-index', 'build');
  const epoch = randomUUID();
  assert.equal(await cursors.save('signed-index', 'build', first, epoch, 10n), true);
  assert.equal(await cursors.save('signed-index', 'build', stale, epoch, 20n), false);
  assert.equal((await cursors.read('signed-index', 'build')).position, 10n);
  assert.equal((await cursors.read('other-index', 'build')).position, 0n);
  // Recovery may repeat a migration whose table already exists; persisted offsets survive.
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=48');
  await migrate(f.catalog.pool);
  await migrate(f.catalog.pool);
  assert.equal((await cursors.read('signed-index', 'build')).position, 10n);
});

test(
  'change feed retries a failed batch without advancing its durable cursor',
  { timeout: 15000 },
  async (t) => {
    const f = await setup(t);
    await publish(f);
    const log = new PostgresEventLog(f.catalog.pool);
    await log.sequence();
    const cursors = new PostgresModuleCursors(f.catalog.pool);
    const host = new ModuleChangeFeed(log, cursors, () => true);
    t.after(() => host.close());
    let attempts = 0,
      first;
    let finish;
    const delivered = new Promise((resolve) => {
      finish = resolve;
    });
    const subscription = host.for('signed-index').subscribe({
      consumer: 'build',
      types: ['artifact.published'],
      batch: 10,
      handle: async (events) => {
        attempts++;
        if (attempts === 1) {
          first = events[0].id;
          throw Error('retry');
        }
        assert.equal(events[0].id, first);
        finish();
      },
      resync: async () => assert.fail('unexpected resync'),
    });
    host.activate('signed-index');
    await delivered;
    // close can precede acknowledgement: at-least-once permits that safe replay.
    await subscription.close();
    assert.equal(attempts, 2);
  },
);

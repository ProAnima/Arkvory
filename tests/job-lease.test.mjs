import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresJobLease } from '@proanima/arkvory-infrastructure';

test('completion renewal has one in-flight request and late success cannot revive ownership', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let calls = 0,
    release;
  let finished = 0;
  const lease = new PostgresJobLease(
    {
      heartbeat: async () => {
        calls++;
        return (
          calls === 1 ||
          (await new Promise((resolve) => {
            release = resolve;
          }))
        );
      },
      finish: async () => {
        finished++;
        return true;
      },
    },
    'job',
    7,
    () => true,
  );
  await lease.start();
  t.mock.timers.tick(2000);
  assert.equal(calls, 2);
  t.mock.timers.tick(20000);
  assert.equal(calls, 2, 'renewals accumulated behind a stalled request');
  assert.throws(() => lease.check(), { code: 'unavailable' });
  release(true);
  await lease.close();
  assert.equal(await lease.finish(null), false);
  assert.equal(finished, 0);
  assert.throws(() => lease.check(), { code: 'unavailable' });
});

test('completion refuses stale reservations and preserves failed finish acknowledgement', async () => {
  let active = true,
    finishCalls = 0;
  const jobs = {
    heartbeat: async () => true,
    finish: async () => {
      finishCalls++;
      return false;
    },
  };
  const lease = new PostgresJobLease(jobs, 'job', 2, () => active);
  await lease.start();
  assert.equal(await lease.finish(null), false);
  assert.equal(finishCalls, 1);
  const lost = new PostgresJobLease(jobs, 'job', 3, () => active);
  await lost.start();
  active = false;
  assert.equal(await lost.finish(null), false);
  active = true;
  assert.equal(lost.active, false);
  await assert.rejects(lost.start());
  const stale = new PostgresJobLease(
    { ...jobs, heartbeat: async () => false },
    'job',
    1,
    () => true,
  );
  await assert.rejects(stale.start(), { code: 'unavailable' });
  assert.equal(await stale.finish(null), false);
  assert.equal(finishCalls, 1);
});

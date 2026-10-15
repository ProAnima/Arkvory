import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadSchedulePolicy } from '@proanima/arkvory-domain';
import { DownloadScheduler } from '@proanima/arkvory-infrastructure';

const request = (id, extra = {}) => ({
  key: `fleet\nobject\n${id}`,
  principal: extra.principal ?? id,
  class: 'release',
  size: 1000,
  queueAware: true,
  ...extra,
});
const range = (start, end) => ({ start, end, open: false });

function scheduler(t, policy = {}, hold = undefined) {
  let now = 0;
  const instance = new DownloadScheduler(
    downloadSchedulePolicy(1, { sessionMinBytes: 0, rangesPerSession: 4, ...policy }),
    hold,
    () => now,
  );
  t.after(() => instance.close());
  return {
    instance,
    at(next) {
      now = next;
    },
  };
}

test('a lease takes exactly its own streamed bytes out of the estimate when it ends', (t) => {
  const s = scheduler(t);
  const first = s.instance.admit(request('big', { range: range(0, 499) }));
  const second = s.instance.admit(request('big', { range: range(500, 999) }));
  assert.equal(first.state, 'active');
  assert.equal(second.state, 'active');
  assert.equal(s.instance.admit(request('next')).state, 'queued');
  first.lease.progress(500);
  first.lease.end({ finished: true });
  second.lease.progress(200);
  s.at(1000);
  s.instance.plan();
  // 300 bytes are left at 700 B/s.
  assert.equal(s.instance.admit(request('next')).startsAt, 1429);
  second.lease.progress(300);
  second.lease.end({ finished: true });
  assert.equal(s.instance.snapshot.completed, 1);
});

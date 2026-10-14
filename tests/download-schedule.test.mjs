import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DownloadSessions,
  downloadSchedulePolicy,
  downloadCheckDelay,
  estimateDownloadStarts,
  orderWaitingDownloads,
  requestedDownloadClass,
} from '@proanima/arkvory-domain';

const session = (key, extra = {}) => ({
  key,
  principal: extra.principal ?? 'fleet',
  class: extra.class ?? 'release',
  size: extra.size ?? 100,
});

test('a mass update is served whole downloads at a time and every place is returned', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(2, { interactiveReserve: 0 }));
  let now = 0;
  const answers = ['a', 'b', 'c', 'd', 'e'].map((key) => sessions.request(session(key), now));
  assert.deepEqual(
    answers.map((answer) => answer.state),
    ['active', 'active', 'queued', 'queued', 'queued'],
  );
  // The first responses end mid-file: the sessions keep their places.
  sessions.end('a', false, now);
  sessions.end('b', false, now);
  sessions.plan(now);
  // Further ranges of an active session pass without a new admission.
  assert.equal(sessions.request(session('a'), now).state, 'active');
  sessions.end('a', false, now);
  assert.deepEqual(
    ['c', 'd', 'e'].map((key) => sessions.request(session(key), now).position),
    [1, 2, 3],
  );
  const order = [];
  for (const key of ['a', 'b', 'c', 'd', 'e']) {
    if (sessions.request(session(key), now).state !== 'active') {
      sessions.plan(now);
      assert.equal(sessions.request(session(key), now).state, 'active');
    }
    order.push(key);
    now += 1000;
    sessions.progress(key, 100, now);
    sessions.end(key, true, now);
  }
  sessions.plan(now);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(sessions.idle, true);
  const snapshot = sessions.snapshot(now);
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.completed, 5);
});

test('people get the reserved place during a mass update', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(3));
  assert.equal(sessions.request(session('a'), 0).state, 'active');
  assert.equal(sessions.request(session('b', { principal: 'other' }), 0).state, 'active');
  assert.equal(sessions.request(session('c', { principal: 'third' }), 0).state, 'queued');
  // The person passes the waiting update at once: the reserved place is for people.
  assert.equal(
    sessions.request(session('person', { principal: 'ann', class: 'interactive' }), 0).state,
    'active',
  );
  sessions.plan(0);
  assert.equal(sessions.request(session('c', { principal: 'third' }), 0).state, 'queued');
  // A second person while all places are taken waits like anyone else, ahead by weight.
  assert.equal(
    sessions.request(session('bob', { principal: 'bob', class: 'interactive' }), 0).state,
    'queued',
  );
  sessions.end('a', true, 0);
  sessions.plan(0);
  assert.equal(
    sessions.request(session('bob', { principal: 'bob', class: 'interactive' }), 0).state,
    'active',
  );
  assert.equal(sessions.request(session('c', { principal: 'third' }), 0).state, 'queued');
});

test('classes alternate by weight, principals take turns, small objects can go first', () => {
  const policy = downloadSchedulePolicy(4);
  const item = (seq, extra) => ({
    principal: 'p',
    class: 'release',
    size: 10,
    seq,
    queuedAt: 0,
    ...extra,
  });
  const mixed = [
    ...[1, 2, 3, 4].map((seq) => item(seq, { class: 'bulk' })),
    ...[5, 6, 7, 8].map((seq) => item(seq)),
  ];
  assert.deepEqual(
    orderWaitingDownloads(mixed, policy, 0).map((entry) => entry.class),
    ['release', 'bulk', 'release', 'release', 'bulk', 'release', 'bulk', 'bulk'],
  );
  const fleets = [1, 2, 3].map((seq) => item(seq, { principal: 'big' }));
  fleets.push(item(4, { principal: 'small' }));
  assert.deepEqual(
    orderWaitingDownloads(fleets, policy, 0).map((entry) => entry.seq),
    [1, 4, 2, 3],
  );
  const sizes = [item(1, { size: 300 }), item(2, { size: 10 }), item(3, { size: 20 })];
  assert.deepEqual(
    orderWaitingDownloads(sizes, { ...policy, strategy: 'smallest-first' }, 0).map(
      (entry) => entry.seq,
    ),
    [2, 3, 1],
  );
  // Aging: background waiting three aging periods competes three classes higher.
  const aged = [item(2), item(1, { class: 'background', queuedAt: 0 })];
  const later = 3 * policy.agingMs;
  const newer = aged.map((entry) => (entry.seq === 2 ? { ...entry, queuedAt: later } : entry));
  assert.deepEqual(
    orderWaitingDownloads(newer, policy, later).map((entry) => entry.seq),
    [1, 2],
  );
});

test('a client may lower its class but never raise it', () => {
  assert.equal(requestedDownloadClass('release', 'bulk'), 'bulk');
  assert.equal(requestedDownloadClass('release', 'interactive'), 'release');
  assert.equal(requestedDownloadClass('bulk', 'nonsense'), 'bulk');
  assert.equal(requestedDownloadClass('interactive', undefined), 'interactive');
});

test('idle places and clients that never come back are freed on the tick', () => {
  const policy = downloadSchedulePolicy(1, { idleMs: 30000 });
  const sessions = new DownloadSessions(policy);
  assert.equal(sessions.request(session('a'), 0).state, 'active');
  const told = sessions.request(session('b'), 0);
  assert.equal(told.state, 'queued');
  sessions.progress('a', 50, 0);
  sessions.end('a', false, 0);
  // Still inside the idle allowance: the place is kept; b keeps checking back.
  assert.equal(sessions.request(session('b'), 29000).state, 'queued');
  sessions.plan(29000);
  assert.equal(sessions.snapshot(29000).active, 1);
  sessions.plan(31000);
  assert.equal(sessions.snapshot(31000).active, 1, 'b took the freed place');
  // b never comes: its reservation lapses and nothing is left behind.
  sessions.plan(10 * 60 * 1000);
  assert.equal(sessions.idle, true);
  assert.equal(sessions.snapshot(10 * 60 * 1000).noShows, 1);
});

test('the number of sessions is bounded and overflow is told to come back', () => {
  const sessions = new DownloadSessions(
    downloadSchedulePolicy(1, { maxSessions: 3, maxSessionsPerPrincipal: 2 }),
  );
  sessions.request(session('a'), 0);
  sessions.request(session('b'), 0);
  assert.throws(
    () => sessions.request(session('c'), 0),
    (error) => error.code === 'busy' && error.retryAfterSeconds === 60,
  );
  sessions.request(session('d', { principal: 'other' }), 0);
  assert.throws(() => sessions.request(session('e', { principal: 'third' }), 0), {
    code: 'busy',
  });
  sessions.drain();
  assert.throws(() => sessions.request(session('f', { principal: 'fourth' }), 0), {
    code: 'busy',
  });
});

test('start estimates follow the bytes ahead and check-backs get denser near the start', () => {
  // Two places at 200 B/s: 100 B/s each. Active remaining 100 and 300, waiting 100 each.
  assert.deepEqual(estimateDownloadStarts([300, 100], [100, 100, 100], 2, 200), [1000, 2000, 3000]);
  assert.deepEqual(estimateDownloadStarts([], [1], 1, 0), [undefined]);
  assert.equal(downloadCheckDelay(10_000, 1, 1000), 5000);
  assert.equal(downloadCheckDelay(0, 1, 1000), 2000);
  assert.equal(downloadCheckDelay(60 * 60 * 1000, 1, 1000), 5 * 60 * 1000);
  // A queued client sees its position and an estimate once bytes flow.
  const sessions = new DownloadSessions(downloadSchedulePolicy(1));
  sessions.request(session('a', { size: 1000 }), 0);
  sessions.request(session('b', { size: 1000 }), 0);
  sessions.progress('a', 500, 1000);
  sessions.plan(1000);
  const answer = sessions.request(session('b'), 1000);
  assert.equal(answer.state, 'queued');
  assert.equal(answer.position, 1);
  assert.ok(answer.startsAt > 1000 && answer.checkAt > 1000);
});

test('an invalid schedule is refused', () => {
  for (const overrides of [
    { interactiveReserve: 2 },
    { perPrincipalActive: 3 },
    { strategy: 'random' },
    { weights: { interactive: 0, release: 1, bulk: 1, background: 1 } },
    { idleMs: 10 },
  ])
    assert.throws(() => downloadSchedulePolicy(2, overrides), { code: 'invalid_input' });
});

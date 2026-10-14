import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DownloadCoverage,
  DownloadSessions,
  downloadSchedulePolicy,
  downloadCheckDelay,
  estimateDownloadStarts,
  orderWaitingDownloads,
  parseDownloadWeights,
  requestedDownloadClass,
} from '@proanima/arkvory-domain';

const session = (key, extra = {}) => ({
  key,
  principal: extra.principal ?? 'fleet',
  class: extra.class ?? 'release',
  size: extra.size ?? 100,
  queueAware: extra.queueAware ?? true,
});
/** A response of `range` sent to its end; `open` for `bytes=X-` or no Range at all. */
const sent = (start, end, open = false) => ({ finished: true, range: { start, end, open } });
/** A whole object of 100 bytes, and a range in its middle. */
const whole = sent(0, 99, true);
const middle = sent(0, 9);

test('a mass update is served whole downloads at a time and every place is returned', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(2));
  let now = 0;
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const answers = keys.map((key) => sessions.request(session(key), now));
  assert.deepEqual(
    answers.map((answer) => answer.state),
    ['active', 'active', 'queued', 'queued', 'queued'],
  );
  // A new session learns its place at the next tick, so it is told to come back soon.
  assert.equal(answers[2].position, undefined);
  assert.equal(answers[2].checkAt, 2000);
  sessions.end('a', middle, now);
  sessions.end('b', middle, now);
  sessions.plan(now);
  // Further ranges of an active session pass without a new admission.
  assert.equal(sessions.request(session('a'), now).state, 'active');
  sessions.end('a', middle, now);
  assert.deepEqual(
    ['c', 'd', 'e'].map((key) => sessions.request(session(key), now).position),
    [1, 2, 3],
  );
  for (const key of keys) {
    if (sessions.request(session(key), now).state !== 'active') {
      sessions.plan(now);
      assert.equal(sessions.request(session(key), now).state, 'active');
    }
    now += 1000;
    sessions.progress(key, 100, now);
    sessions.end(key, whole, now);
  }
  sessions.plan(now);
  assert.equal(sessions.idle, true);
  const snapshot = sessions.snapshot(now);
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.completed, 5);
  assert.deepEqual(snapshot.waiting, { interactive: 0, release: 0, bulk: 0, background: 0 });
});

test('no place is held for an absent client: whoever is first in line and comes takes it', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1));
  sessions.request(session('busy'), 0);
  for (const key of ['b', 'c', 'd']) sessions.request(session(key), 0);
  sessions.progress('busy', 100, 0);
  sessions.end('busy', whole, 0);
  sessions.plan(1000);
  // b is first but absent; c is also in the window of twice the free places and comes first.
  assert.equal(sessions.request(session('d'), 1000).state, 'queued');
  assert.equal(sessions.request(session('c'), 1000).state, 'active');
  assert.equal(sessions.request(session('b'), 1000).state, 'queued');
});

test('people get the reserved place during a mass update; the reserve needs four places', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(4));
  for (const key of ['a', 'b', 'c'])
    assert.equal(sessions.request(session(key), 0).state, 'active');
  assert.equal(sessions.request(session('d'), 0).state, 'queued');
  const person = session('person', { principal: 'ann', class: 'interactive' });
  assert.equal(sessions.request(person, 0).state, 'active');
  assert.equal(downloadSchedulePolicy(3).interactiveReserve, 0);
  assert.equal(downloadSchedulePolicy(4).interactiveReserve, 1);
});

/** Asks for `[start, end]` of `request` and sends it to its end. */
function read(sessions, request, start, end, open = false, now = 0) {
  const range = { start, end, open };
  assert.equal(sessions.request({ ...request, range }, now).state, 'active');
  sessions.progress(request.key, end - start + 1, now);
  sessions.end(request.key, { finished: true, range }, now);
}

test('reading the last range first does not finish a download; all its bytes do', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1));
  const zip = session('zip', { size: 100 });
  // `bytes=-10` or `bytes=90-99`: a bounded read of the tail says nothing of the start.
  read(sessions, zip, 90, 99);
  assert.equal(sessions.snapshot(0).active, 1, 'the central directory is not the whole file');
  read(sessions, zip, 0, 49);
  assert.equal(sessions.snapshot(0).active, 1, 'bytes 50 to 89 are missing');
  read(sessions, zip, 50, 89);
  assert.equal(sessions.snapshot(0).completed, 1);
  assert.equal(sessions.idle, true);
});

test('delivered ranges merge, stay bounded and never cover a byte that was not sent', () => {
  const coverage = new DownloadCoverage();
  coverage.add(10, 19);
  coverage.add(0, 9);
  coverage.add(30, 39);
  assert.equal(coverage.size, 2, 'adjacent ranges are one');
  assert.equal(coverage.covers(0, 19), true);
  assert.equal(coverage.covers(0, 39), false, 'bytes 20 to 29 are missing');
  assert.equal(coverage.bytesFrom(5), 25);
  coverage.add(15, 35);
  assert.equal(coverage.covers(0, 39), true);
  // Scattered ranges: at most 64 are kept; the smallest go, so coverage only shrinks.
  const scattered = new DownloadCoverage();
  for (let index = 0; index < 100; index++) scattered.add(index * 10, index * 10 + (index % 5));
  assert.equal(scattered.size, 64);
  assert.equal(scattered.covers(0, 999), false);
  scattered.add(0, 999);
  assert.equal(scattered.size, 1);
  assert.equal(scattered.covers(0, 999), true);
});

test('a download resumed from an offset completes without the bytes before it', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1));
  // curl -C - and wget -c ask `bytes=X-`: one response to the end is the whole download.
  read(sessions, session('curl', { size: 100 }), 60, 99, true);
  assert.equal(sessions.snapshot(0).completed, 1);
  // The SDK resumes with bounded ranges from its offset; its last range ends the download.
  read(sessions, session('sdk', { size: 100 }), 40, 69);
  assert.equal(sessions.snapshot(0).active, 1);
  read(sessions, session('sdk', { size: 100 }), 70, 99);
  assert.equal(sessions.snapshot(0).completed, 2);
  assert.equal(sessions.idle, true);
});

test('an aborted range delivers nothing; the session completes only with every range in', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1, { rangesPerSession: 4 }));
  const big = session('big', { size: 100 });
  const range = (start, end) => ({ start, end, open: false });
  // Two ranges at once: the second aborts after streaming most of its bytes.
  assert.equal(sessions.request({ ...big, range: range(0, 49) }, 0).state, 'active');
  assert.equal(sessions.request({ ...big, range: range(50, 99) }, 0).state, 'active');
  sessions.progress('big', 50, 0);
  sessions.progress('big', 45, 0);
  sessions.end('big', { finished: false, range: range(50, 99) }, 0);
  sessions.end('big', { finished: true, range: range(0, 49) }, 0);
  assert.equal(sessions.snapshot(0).active, 1, 'the aborted range is not delivered');
  read(sessions, big, 50, 99);
  assert.equal(sessions.snapshot(0).completed, 1);
});

test('a download that paused keeps its turn and its delivered ranges when it comes back', () => {
  const policy = downloadSchedulePolicy(1, { idleMs: 30000 });
  const sessions = new DownloadSessions(policy);
  const big = session('big', { size: 1000 });
  read(sessions, big, 0, 899);
  const later = session('later', { principal: 'other' });
  for (let at = 1000; at <= 31000; at += 2000) sessions.request(later, at);
  sessions.plan(31000);
  const snapshot = sessions.snapshot(31000);
  assert.equal(snapshot.released, 1);
  assert.equal(snapshot.resumable, 1);
  // It returns while the other one waits: no place at once, but its arrival is kept, so it is
  // among the first in line at the next tick.
  assert.equal(sessions.request(big, 32000).state, 'queued');
  sessions.plan(32500);
  read(sessions, big, 900, 999, false, 32500);
  assert.equal(sessions.snapshot(32500).completed, 1, 'its first 900 bytes still count');
});

test('a resumed download is not admitted ahead of one that came before it', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1, { idleMs: 30000 }));
  const paused = session('paused', { principal: 'b', size: 1000 });
  read(sessions, paused, 0, 99);
  // A download back from a restart with a ticket: it came before the paused one.
  const early = { ...session('early', { principal: 'a' }), arrivedAt: -60_000 };
  for (let at = 1000; at <= 29000; at += 2000) {
    sessions.plan(at);
    assert.equal(sessions.request(early, at).state, 'queued');
  }
  sessions.plan(31000);
  assert.equal(sessions.snapshot(31000).resumable, 1);
  // The place is free; the paused one comes back first but waits in line.
  assert.equal(sessions.request(paused, 31100).state, 'queued');
  assert.equal(sessions.request(early, 31200).state, 'active');
  sessions.plan(31500);
  assert.equal(sessions.request(paused, 31500).position, 1);
});

test('one session runs a bounded number of ranges at once', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(2, { rangesPerSession: 2 }));
  assert.equal(sessions.request(session('nat'), 0).state, 'active');
  assert.equal(sessions.request(session('nat'), 0).state, 'active');
  assert.throws(() => sessions.request(session('nat'), 0), {
    code: 'busy',
    retryAfterSeconds: 1,
  });
  sessions.end('nat', middle, 0);
  assert.equal(sessions.request(session('nat'), 0).state, 'active');
});

test('a client of the queue protocol yields at a range boundary to a higher class', () => {
  // Places are not freed by a pause in these runs: idle time is longer than the hold.
  const policy = downloadSchedulePolicy(1, { idleMs: 120_000 });
  const sessions = new DownloadSessions(policy);
  const bulk = session('agent', { principal: 'agents', class: 'bulk', size: 1000 });
  assert.equal(sessions.request(bulk, 0).state, 'active');
  sessions.end('agent', middle, 0);
  const ci = session('ci', { principal: 'ci', size: 1000 });
  assert.equal(sessions.request(ci, 0).state, 'queued');
  sessions.plan(1000);
  // Within the first minute the place is kept.
  assert.equal(sessions.request(bulk, 1000).state, 'active');
  sessions.end('agent', middle, 1000);
  // The CI keeps checking, as told.
  for (const at of [15000, 30000, 45000, 60000]) sessions.request(ci, at);
  sessions.plan(61000);
  const yielded = sessions.request(bulk, 61000);
  assert.equal(yielded.state, 'queued');
  // The next tick marks the freed place, and the CI takes it.
  sessions.plan(61500);
  assert.equal(sessions.request(ci, 61500).state, 'active');
  assert.equal(sessions.snapshot(61000).yielded, 1);
  // A tool outside the protocol is never interrupted.
  const tool = new DownloadSessions(policy);
  const curl = session('curl', { principal: 'agents', class: 'bulk', queueAware: false });
  tool.request(curl, 0);
  tool.end('curl', middle, 0);
  const waitingCi = session('ci', { principal: 'ci' });
  for (const at of [0, 20000, 40000, 60000]) tool.request(waitingCi, at);
  tool.plan(61000);
  assert.equal(tool.request(curl, 61000).state, 'active');
  // And with preemption off nobody yields.
  const off = new DownloadSessions({ ...policy, preempt: false });
  off.request(bulk, 0);
  off.end('agent', middle, 0);
  for (const at of [0, 20000, 40000, 60000]) off.request(ci, at);
  off.plan(61000);
  assert.equal(off.request(bulk, 61000).state, 'active');
});

test('a principal above its share yields to one below it', () => {
  const sessions = new DownloadSessions(
    downloadSchedulePolicy(2, { perPrincipalActive: 1, idleMs: 120_000 }),
  );
  const fleet = ['f1', 'f2'].map((key) => session(key, { principal: 'fleet', size: 1000 }));
  for (const request of fleet) {
    assert.equal(sessions.request(request, 0).state, 'active');
    sessions.end(request.key, middle, 0);
  }
  const ci = session('ci', { principal: 'ci', size: 1000 });
  assert.equal(sessions.request(ci, 0).state, 'queued');
  for (const at of [15000, 30000, 45000, 60000]) sessions.request(ci, at);
  sessions.plan(61000);
  assert.equal(sessions.request(fleet[0], 61000).state, 'queued');
  sessions.plan(61500);
  assert.equal(sessions.request(ci, 61500).state, 'active');
  // The fleet is at its share now: its other session keeps the place.
  sessions.plan(62000);
  assert.equal(sessions.request(fleet[1], 62000).state, 'active');
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
});

test('aging lifts long waits up to release, never into the lane of people', () => {
  const policy = downloadSchedulePolicy(4);
  const later = 10 * policy.agingMs;
  const waiting = [
    { principal: 'p', class: 'interactive', size: 1, seq: 3, queuedAt: later },
    { principal: 'p', class: 'release', size: 1, seq: 2, queuedAt: later },
    { principal: 'q', class: 'background', size: 1, seq: 1, queuedAt: 0 },
  ];
  const order = orderWaitingDownloads(waiting, policy, later).map((entry) => entry.seq);
  // Background competes as release now, first come in that lane; the person stays first.
  assert.deepEqual(order, [3, 1, 2]);
  const still = orderWaitingDownloads(waiting, { ...policy, agingMs: 0 }, later);
  assert.deepEqual(
    still.map((entry) => entry.seq),
    [3, 2, 1],
  );
});

test('ordering 65 536 waiting sessions over many principals stays cheap', () => {
  const policy = downloadSchedulePolicy(16);
  const waiting = Array.from({ length: 65536 }, (_, index) => ({
    principal: index < 4096 ? 'fleet' : `p${String(index)}`,
    class: index % 3 === 0 ? 'bulk' : 'release',
    size: 1,
    seq: index,
    queuedAt: 0,
  }));
  const started = performance.now();
  const order = orderWaitingDownloads(waiting, policy, 0);
  const elapsed = performance.now() - started;
  assert.equal(order.length, 65536);
  assert.ok(elapsed < 1000, `ordering took ${String(elapsed)} ms`);
});

test('a client may lower its class, never raise it, and a typo is refused', () => {
  assert.equal(requestedDownloadClass('release', 'bulk'), 'bulk');
  assert.equal(requestedDownloadClass('release', ' Bulk '), 'bulk');
  assert.equal(requestedDownloadClass('release', 'interactive'), 'release');
  assert.equal(requestedDownloadClass('interactive', undefined), 'interactive');
  assert.throws(() => requestedDownloadClass('bulk', 'nonsense'), { code: 'invalid_input' });
});

test('clients that never come back and idle places are freed on the tick', () => {
  const sessions = new DownloadSessions(downloadSchedulePolicy(1, { idleMs: 30000 }));
  assert.equal(sessions.request(session('a'), 0).state, 'active');
  sessions.progress('a', 100, 0);
  sessions.end('a', middle, 0);
  sessions.request(session('b'), 0);
  sessions.plan(29000);
  assert.equal(sessions.snapshot(29000).active, 1);
  sessions.plan(10 * 60 * 1000);
  assert.equal(sessions.idle, true);
  const snapshot = sessions.snapshot(10 * 60 * 1000);
  assert.equal(snapshot.noShows, 1);
  assert.equal(snapshot.released, 1);
});

test('the number of sessions is bounded; a stopping server hands no place on', () => {
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
  sessions.end('a', middle, 0);
  // The active download goes on; the waiting ones are sent elsewhere.
  assert.equal(sessions.request(session('a'), 0).state, 'active');
  assert.throws(() => sessions.request(session('b'), 0), { code: 'busy', retryAfterSeconds: 2 });
});

test('start estimates follow the bytes ahead and check-backs get denser near the start', () => {
  // Two places at 200 B/s: 100 B/s each. Active remaining 100 and 300, waiting 100 each.
  assert.deepEqual(estimateDownloadStarts([300, 100], [100, 100, 100], 2, 200), [1000, 2000, 3000]);
  assert.deepEqual(estimateDownloadStarts([], [1], 1, 0), [undefined]);
  assert.equal(downloadCheckDelay(10_000, 1, 1000), 5000);
  assert.equal(downloadCheckDelay(0, 1, 1000), 2000);
  assert.equal(downloadCheckDelay(60 * 60 * 1000, 1, 1000), 5 * 60 * 1000);
  const sessions = new DownloadSessions(downloadSchedulePolicy(1));
  sessions.request(session('a', { size: 1000 }), 0);
  for (const key of ['b', 'c']) sessions.request(session(key, { size: 1000 }), 0);
  sessions.progress('a', 100, 500);
  sessions.progress('a', 100, 1500);
  sessions.plan(2000);
  const answer = sessions.request(session('c', { size: 1000 }), 2000);
  assert.equal(answer.state, 'queued');
  assert.equal(answer.position, 2);
  assert.ok(answer.startsAt > 2000 && answer.checkAt > 2000);
});

test('an invalid schedule is refused and names the rule', () => {
  for (const [overrides, rule] of [
    [{ interactiveReserve: 2 }, /interactiveReserve/],
    [{ perPrincipalActive: 3 }, /perPrincipalActive/],
    [{ strategy: 'random' }, /strategy/],
    [{ weights: { interactive: 0, release: 1, bulk: 1, background: 1 } }, /weights/],
    [{ idleMs: 10 }, /idleMs/],
    [{ agingMs: 1000 }, /agingMs/],
    [{ rangesPerSession: 0 }, /rangesPerSession/],
  ])
    assert.throws(() => downloadSchedulePolicy(2, overrides), {
      code: 'invalid_input',
      message: rule,
    });
  assert.deepEqual(parseDownloadWeights('bulk=3, background=2'), {
    interactive: 8,
    release: 4,
    bulk: 3,
    background: 2,
  });
  for (const wrong of ['bulk', 'bulk=0', 'nobody=2', 'bulk=1.5'])
    assert.throws(() => parseDownloadWeights(wrong), { code: 'invalid_input' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookDelivery, WebhookFailure, webhookBackoffMs } from '@proanima/arkvory-application';

const live = { throwIfAborted() {} };

/** A feed of one repository with a growing journal; sequences are decimal strings like the real feed. */
function feed(entries = []) {
  const journal = [...entries];
  return {
    journal,
    add(action, artifactId = `artifact-${journal.length + 1}`, detail = null) {
      const sequence = String((journal.at(-1) ? Number(journal.at(-1).sequence) : 0) + 1);
      journal.push({ sequence, action, artifactId, detail });
    },
    async changes(_repository, after, limit) {
      const items = journal
        .filter((entry) => BigInt(entry.sequence) > BigInt(after))
        .slice(0, limit);
      return { items, head: journal.at(-1)?.sequence ?? '0' };
    },
  };
}

function states() {
  const rows = new Map();
  return {
    rows,
    saves: 0,
    async load(subscription) {
      return rows.get(subscription) ?? null;
    },
    async save(state) {
      this.saves++;
      rows.set(state.subscription, structuredClone(state));
    },
    async all() {
      return [...rows.values()];
    },
  };
}

function rig(options = {}) {
  const journal = options.feed ?? feed();
  const store = options.states ?? states();
  const sent = [];
  let clock = Date.parse('2026-10-07T10:00:00Z');
  const sender = {
    async send(event) {
      if (options.fail?.(event, sent)) throw options.fail(event, sent);
      sent.push(event);
    },
  };
  const delivery = new WebhookDelivery({
    subscription: 'ci',
    repository: 'releases',
    ...(options.actions ? { actions: options.actions } : {}),
    feed: journal,
    sender: options.sender ?? sender,
    states: store,
    now: () => new Date(clock).toISOString(),
    random: () => 0.5,
  });
  return { journal, store, sent, delivery, advance: (ms) => (clock += ms) };
}

test('a new subscription starts at the head: history is never delivered', async () => {
  const r = rig({
    feed: feed([{ sequence: '5', action: 'artifact.publish', artifactId: 'old', detail: null }]),
  });
  assert.equal(await r.delivery.step(live), 'idle');
  assert.equal(r.store.rows.get('ci').cursor, '5');
  assert.deepEqual(r.sent, []);
  r.journal.add('artifact.publish', 'new');
  assert.equal(await r.delivery.step(live), 'delivered');
  assert.deepEqual(
    r.sent.map((event) => event.artifactId),
    ['new'],
  );
  assert.equal(await r.delivery.step(live), 'idle');
});

test('events arrive in feed order with a stable id, and the cursor moves only after each success', async () => {
  const r = rig();
  await r.delivery.step(live);
  r.journal.add('artifact.publish', 'a');
  r.journal.add('asset.replace', 'b', 'tools/setup.exe');
  r.journal.add('stage.add', 'c', 'qa');
  await r.delivery.step(live);
  assert.deepEqual(
    r.sent.map(({ id, repository, sequence, action, artifactId, detail }) => ({
      id,
      repository,
      sequence,
      action,
      artifactId,
      detail,
    })),
    [
      {
        id: 'releases:1',
        repository: 'releases',
        sequence: '1',
        action: 'artifact.publish',
        artifactId: 'a',
        detail: null,
      },
      {
        id: 'releases:2',
        repository: 'releases',
        sequence: '2',
        action: 'asset.replace',
        artifactId: 'b',
        detail: 'tools/setup.exe',
      },
      {
        id: 'releases:3',
        repository: 'releases',
        sequence: '3',
        action: 'stage.add',
        artifactId: 'c',
        detail: 'qa',
      },
    ],
  );
  assert.equal(r.store.rows.get('ci').cursor, '3');
  assert.equal(r.store.rows.get('ci').deliveredCount, 3);
});

test('a failure keeps the cursor, records the code and backs off; the same event is sent again later', async () => {
  let down = true;
  const r = rig({
    fail: (event) => (down && event.sequence === '2' ? new WebhookFailure('http_5xx') : null),
  });
  await r.delivery.step(live);
  r.journal.add('artifact.publish', 'a');
  r.journal.add('artifact.publish', 'b');
  r.journal.add('artifact.publish', 'c');
  assert.equal(await r.delivery.step(live), 'failed');
  const failed = r.store.rows.get('ci');
  assert.equal(failed.cursor, '1', 'event 1 was delivered, event 2 was not');
  assert.equal(failed.failures, 1);
  assert.equal(failed.errorCode, 'http_5xx');
  assert.ok(Date.parse(failed.nextAttemptAt) > Date.parse(failed.errorAt));
  assert.deepEqual(
    r.sent.map((event) => event.sequence),
    ['1'],
    'order: 3 never overtakes 2',
  );

  // Inside the backoff nothing is attempted.
  assert.equal(await r.delivery.step(live), 'idle');
  assert.equal(r.store.rows.get('ci').failures, 1);

  // The receiver is back; after the backoff event 2 comes first, then 3, under the same ids.
  down = false;
  r.advance(3_700_000);
  assert.equal(await r.delivery.step(live), 'delivered');
  assert.deepEqual(
    r.sent.map((event) => event.id),
    ['releases:1', 'releases:2', 'releases:3'],
  );
  const healthy = r.store.rows.get('ci');
  assert.equal(healthy.failures, 0);
  assert.equal(healthy.errorCode, null);
  assert.equal(healthy.nextAttemptAt, null);
});

test('a non-WebhookFailure error from the sender is recorded as a network failure', async () => {
  const r = rig({ fail: () => new Error('socket hang up with https://secret.example/token') });
  await r.delivery.step(live);
  r.journal.add('artifact.publish');
  assert.equal(await r.delivery.step(live), 'failed');
  const state = r.store.rows.get('ci');
  assert.equal(state.errorCode, 'network');
  assert.ok(
    !JSON.stringify(state).includes('secret.example'),
    'error text never reaches the state',
  );
});

test('a crash after the receiver answered but before the cursor was saved repeats the event under the same id', async () => {
  const store = states();
  const first = rig({ states: store });
  await first.delivery.step(live);
  first.journal.add('artifact.publish', 'a');
  // The process dies while saving the cursor of event 1.
  const save = store.save.bind(store);
  store.save = async (state) => {
    if (state.cursor === '1') throw new Error('crash');
    return save(state);
  };
  await assert.rejects(first.delivery.step(live), /crash/);
  assert.equal(first.sent.length, 1);
  assert.equal(store.rows.get('ci').cursor, '0');
  store.save = save;
  // A restarted worker (a new delivery object on the same rows and journal) delivers it again.
  const second = rig({ states: store, feed: first.journal });
  assert.equal(await second.delivery.step(live), 'delivered');
  assert.equal(second.sent[0].id, first.sent[0].id);
});

test('actions filter what is delivered; skipped events still move the cursor', async () => {
  const r = rig({ actions: ['artifact.publish'] });
  await r.delivery.step(live);
  r.journal.add('reference.add');
  r.journal.add('artifact.publish', 'keep');
  r.journal.add('attachments.replace');
  assert.equal(await r.delivery.step(live), 'delivered');
  assert.deepEqual(
    r.sent.map((event) => event.artifactId),
    ['keep'],
  );
  assert.equal(r.store.rows.get('ci').cursor, '3');
  // Only skipped events: nothing is delivered, the cursor still advances and is saved.
  r.journal.add('reference.remove');
  assert.equal(await r.delivery.step(live), 'idle');
  assert.equal(r.store.rows.get('ci').cursor, '4');
});

test('a full page reports more to come so the loop continues without pausing', async () => {
  const r = rig();
  await r.delivery.step(live);
  for (let index = 0; index < 150; index++) r.journal.add('artifact.publish');
  assert.equal(await r.delivery.step(live), 'delivered');
  assert.equal(r.sent.length, 100);
  assert.equal(await r.delivery.step(live), 'delivered');
  assert.equal(r.sent.length, 150);
  assert.equal(await r.delivery.step(live), 'idle');
});

test('a subscription pointed at another repository starts again at that feed head', async () => {
  const store = states();
  const first = rig({ states: store });
  await first.delivery.step(live);
  first.journal.add('artifact.publish');
  await first.delivery.step(live);
  store.rows.get('ci').repository = 'archive';
  const moved = rig({ states: store, feed: first.journal });
  assert.equal(await moved.delivery.step(live), 'idle');
  assert.equal(store.rows.get('ci').repository, 'releases');
  assert.equal(store.rows.get('ci').cursor, first.journal.journal.at(-1).sequence);
  assert.equal(moved.sent.length, 0);
});

test('cancellation stops the step before another event is sent', async () => {
  const r = rig();
  await r.delivery.step(live);
  r.journal.add('artifact.publish');
  const stopped = {
    throwIfAborted() {
      throw new Error('aborted');
    },
  };
  await assert.rejects(r.delivery.step(stopped), /aborted/);
  assert.equal(r.sent.length, 0);
  assert.equal(r.store.rows.get('ci').failures, 0, 'a stop is not a failed delivery');
});

test('the backoff is 12 s doubling to an hour with bounded jitter', () => {
  const at = (failures, random) => webhookBackoffMs(failures, () => random);
  assert.equal(at(1, 0.5), 12_000);
  assert.equal(at(2, 0.5), 24_000);
  assert.equal(at(3, 0.5), 48_000);
  assert.equal(at(1, 0), 9_600);
  assert.equal(at(1, 0.999999), 14_400);
  assert.equal(at(30, 0.5), 3_600_000, 'capped at one hour');
  assert.ok(at(30, 0.999999) <= 4_320_000);
  assert.equal(at(0, 0.5), 12_000, 'never below the first wait');
});

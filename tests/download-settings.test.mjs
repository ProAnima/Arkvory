import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadSchedulePolicy,
  overrideDownloadPolicy,
  readDownloadOverrides,
} from '../packages/domain/dist/index.js';
import { DownloadSettingsControl } from '../packages/application/dist/index.js';

const base = downloadSchedulePolicy(16, { perPrincipalActive: 4 });

/** The record in memory, compare-and-swap like the database. */
function memoryStore() {
  let current = { revision: 0, overrides: {}, updatedAt: null, updatedBy: null, actor: null };
  return {
    read: async () => current,
    write: async (expected, overrides, author) => {
      if (expected !== current.revision) return null;
      current = {
        revision: current.revision + 1,
        overrides,
        updatedAt: new Date(0),
        updatedBy: author.id,
        actor: author.actor,
      };
      return current;
    },
    // Another writer of the installation saving directly.
    replace(overrides) {
      current = { ...current, revision: current.revision + 1, overrides };
    },
  };
}

function target() {
  const applied = [];
  return { applied, configure: (policy) => applied.push(policy) };
}

const failure = (field, problem) => (error) =>
  error.code === 'invalid_input' &&
  error.details.some((detail) => detail.field === field && detail.problem === problem);

test('overrides from JSON: known fields with their own types and ranges, nothing else', () => {
  assert.deepEqual(
    readDownloadOverrides({
      strategy: 'smallest-first',
      sessions: 8,
      weights: { interactive: 9, release: 4, bulk: 2, background: 1 },
      preempt: false,
    }),
    {
      strategy: 'smallest-first',
      sessions: 8,
      weights: { interactive: 9, release: 4, bulk: 2, background: 1 },
      preempt: false,
    },
  );
  assert.deepEqual(readDownloadOverrides({}), {});
  assert.throws(() => readDownloadOverrides({ slots: 4 }), failure('/slots', 'unknown_field'));
  assert.throws(() => readDownloadOverrides({ sessions: 0 }), failure('/sessions', 'range'));
  assert.throws(() => readDownloadOverrides({ sessions: '4' }), failure('/sessions', 'type'));
  assert.throws(() => readDownloadOverrides({ strategy: 'fast' }), failure('/strategy', 'invalid'));
  assert.throws(() => readDownloadOverrides({ preempt: 'yes' }), failure('/preempt', 'type'));
  // Every class or none: a partial set would silently keep defaults for the rest.
  assert.throws(
    () => readDownloadOverrides({ weights: { interactive: 2 } }),
    failure('/weights', 'invalid'),
  );
  assert.throws(
    () =>
      readDownloadOverrides({ weights: { interactive: 0, release: 1, bulk: 1, background: 1 } }),
    failure('/weights/interactive', 'range'),
  );
  assert.throws(() => readDownloadOverrides([]), failure('/', 'type'));
});

test('fewer sessions lower the reserve and the share that no longer fit; asked values are checked', () => {
  const two = overrideDownloadPolicy(base, { sessions: 2 });
  assert.equal(two.slots, 2);
  assert.equal(two.interactiveReserve, 1);
  assert.equal(two.perPrincipalActive, 2);
  const one = overrideDownloadPolicy(base, { sessions: 1 });
  assert.equal(one.interactiveReserve, 0);
  // Units of people become the policy's units; the rest stays as the server started.
  const tuned = overrideDownloadPolicy(base, { idleSeconds: 5, agingMinutes: 0 });
  assert.equal(tuned.idleMs, 5000);
  assert.equal(tuned.agingMs, 0);
  assert.equal(tuned.maxSessions, base.maxSessions);
  assert.throws(() => overrideDownloadPolicy(base, { sessions: 4, reserve: 4 }), {
    code: 'invalid_input',
  });
});

test('a change is validated, stored with its author and applied at once; a stale one conflicts', async () => {
  const store = memoryStore();
  const queue = target();
  const control = new DownloadSettingsControl(store, base, queue);
  const first = await control.view();
  assert.equal(first.revision, 0);
  assert.deepEqual(first.effective, first.defaults);
  assert.equal(first.defaults.sessions, 16);
  const changed = await control.change(
    0,
    { sessions: 4, strategy: 'smallest-first' },
    { id: 'fleet:1', actor: 'Ann' },
  );
  assert.equal(changed.revision, 1);
  assert.equal(changed.effective.sessions, 4);
  assert.equal(changed.effective.strategy, 'smallest-first');
  assert.equal(changed.defaults.sessions, 16);
  assert.equal(changed.actor, 'Ann');
  assert.equal(queue.applied.at(-1).slots, 4);
  await assert.rejects(control.change(0, { sessions: 2 }, { id: 'admin', actor: null }), {
    code: 'conflict',
    reason: 'revision_mismatch',
  });
  // Settings that cannot run here are never stored.
  await assert.rejects(
    control.change(1, { sessions: 2, reserve: 2 }, { id: 'admin', actor: null }),
    failure('/overrides', 'invalid'),
  );
  assert.equal((await store.read()).revision, 1);
});

test('sync applies what another writer saved once, and falls back to the defaults when it cannot run', async () => {
  const store = memoryStore();
  const queue = target();
  const control = new DownloadSettingsControl(store, base, queue);
  await control.sync();
  assert.equal(queue.applied.length, 1);
  await control.sync();
  assert.equal(queue.applied.length, 1, 'an unchanged revision is not applied again');
  store.replace({ rangesPerSession: 2 });
  await control.sync();
  assert.equal(queue.applied.at(-1).rangesPerSession, 2);
  // Saved on a server with 16 sessions; this one starts with 8, where the reserve cannot fit.
  store.replace({ reserve: 12 });
  const small = downloadSchedulePolicy(8);
  const other = target();
  const control8 = new DownloadSettingsControl(store, small, other);
  await control8.sync();
  assert.equal(other.applied.at(-1), small);
  const view = await control8.view();
  assert.match(view.problem, /interactiveReserve/);
  assert.deepEqual(view.effective, view.defaults);
});

test('a stored row of a newer release or a bad hand edit is a problem, never a stopped server', async () => {
  const queue = target();
  const row = (overrides) => ({
    read: async () => ({ revision: 3, overrides, updatedAt: null, updatedBy: 'a', actor: null }),
    write: async () => null,
  });
  // A field this release does not know is left out; the known ones still apply.
  const newer = new DownloadSettingsControl(row({ sessions: 4, windows: [] }), base, queue);
  await newer.sync();
  assert.equal(queue.applied.at(-1).slots, 4);
  const shown = await newer.view();
  assert.deepEqual(shown.overrides, { sessions: 4 });
  assert.equal(shown.problem, null);
  // A known field out of range: the environment runs and the reason is shown.
  const broken = new DownloadSettingsControl(row({ sessions: 0 }), base, target());
  await broken.sync();
  const view = await broken.view();
  assert.match(view.problem, /sessions/);
  assert.deepEqual(view.effective, view.defaults);
});

test('a late read of an older revision never replaces a newer change', async () => {
  const store = memoryStore();
  const queue = target();
  const control = new DownloadSettingsControl(store, base, queue);
  const old = await store.read();
  await control.change(0, { sessions: 5 }, { id: 'admin', actor: null });
  // A read of revision 0 that started before the change arrives after it.
  store.read = async () => old;
  await control.sync();
  await control.view();
  assert.equal(queue.applied.at(-1).slots, 5);
});

test('conflicts and refusals leave the queue as it runs; gateways keep shared admission', async () => {
  const store = memoryStore();
  const queue = target();
  const control = new DownloadSettingsControl(store, base, queue, {
    applies: true,
    gateways: true,
  });
  await assert.rejects(
    control.change(0, { strategy: 'ordered' }, { id: 'admin', actor: null }),
    failure('/overrides/strategy', 'invalid'),
  );
  await control.change(0, { strategy: 'shared', sessions: 6 }, { id: 'admin', actor: null });
  const runs = queue.applied.length;
  await assert.rejects(control.change(0, { sessions: 2 }, { id: 'admin', actor: null }), {
    code: 'conflict',
  });
  assert.equal(queue.applied.length, runs);
  const view = await control.view();
  assert.equal(view.admission, 'per-request', 'shared admits per request: sessions wait unused');
  // A read gateway shows what it runs, its environment, and refuses changes.
  const reader = new DownloadSettingsControl(store, base, target(), {
    applies: false,
    gateways: true,
  });
  const seen = await reader.view();
  assert.deepEqual(seen.effective, seen.defaults);
  assert.match(seen.problem, /read gateway/);
  await assert.rejects(reader.change(1, {}, { id: 'admin', actor: null }), { code: 'read_only' });
});

test('with gateways a writer keeps shared admission even for a record that asks for sessions', async () => {
  const store = memoryStore();
  // Saved before the gateways were added, or by a writer that did not know of them.
  store.replace({ strategy: 'smallest-first', sessions: 6 });
  const queue = target();
  const shared = { ...base, strategy: 'shared' };
  const control = new DownloadSettingsControl(store, shared, queue, {
    applies: true,
    gateways: true,
  });
  await control.sync();
  assert.equal(queue.applied.at(-1).strategy, 'shared');
  assert.equal(queue.applied.at(-1), shared, 'the environment runs');
  const view = await control.view();
  assert.equal(view.admission, 'per-request');
  assert.match(view.problem, /strategy stays shared/);
  // Without gateways the same record runs.
  const alone = target();
  await new DownloadSettingsControl(store, base, alone).sync();
  assert.equal(alone.applied.at(-1).strategy, 'smallest-first');
});

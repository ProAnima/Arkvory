import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { RehomeBlobs, planRehome } from '@proanima/arkvory-application';
import {
  ArkvoryError,
  MAX_MOVE_ATTEMPTS,
  afterStep,
  requireMove,
  stepOf,
} from '@proanima/arkvory-domain';

// Moving a published blob between storages (ADR 0083, N2): the steps, their repeats after a
// crash, deferral on busy locks and the end states, on ports without a database.
const bytes = Buffer.from('published bytes moved between two storages');
const descriptor = {
  name: 'a.bin',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  labels: [],
  metadata: {},
};
const cancellation = { throwIfAborted() {} };
async function* once(chunk) {
  yield chunk;
}

/** Storages in memory, one copy per storage and id, each put checked like a real storage. */
class Storages {
  #copies = new Map();
  async put(id, expected, source, check, backend) {
    const chunks = [];
    for await (const chunk of source) {
      check.throwIfAborted();
      chunks.push(Buffer.from(chunk));
    }
    const all = Buffer.concat(chunks);
    if (
      all.length !== expected.size ||
      createHash('sha256').update(all).digest('hex') !== expected.sha256
    )
      throw new ArkvoryError('integrity_mismatch', 'Size or SHA-256 differs');
    this.#copies.set(`${backend}/${id}`, all);
  }
  async *read(id, size, range, backend) {
    const copy = this.#copies.get(`${backend}/${id}`);
    if (!copy) throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
    yield copy.subarray(range?.start ?? 0, (range?.end ?? size - 1) + 1);
  }
  async exists(id, size, backend) {
    if (this.#copies.get(`${backend}/${id}`)?.length !== size)
      throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
  }
  async verify(id, expected, _check, backend) {
    await this.exists(id, expected.size, backend);
    const copy = this.#copies.get(`${backend}/${id}`);
    if (createHash('sha256').update(copy).digest('hex') !== expected.sha256)
      throw new ArkvoryError('integrity_mismatch', 'SHA-256 differs');
  }
  async collect(id, _content, _check, backend) {
    this.#copies.delete(`${backend}/${id}`);
  }
}

/** Two storages in memory, an upload row and a move store that records every write. */
function world({ state = 'accepting' } = {}) {
  const blobs = new Storages();
  const id = randomUUID();
  const upload = { descriptor, status: 'available', storageBackend: 'default' };
  const log = [];
  const record = { state: 'planned', attempts: 0, error: null, generation: 1 };
  const moves = {
    plan: async () => 1,
    advance: async (move, next) => {
      if (move.generation !== record.generation) return false;
      record.state = next;
      log.push(next);
      return true;
    },
    defer: async (move) => {
      log.push('deferred');
      return move.generation === record.generation;
    },
    fail: async (move, code, final) => {
      if (move.generation !== record.generation) return false;
      record.attempts++;
      record.error = code;
      if (final || record.attempts >= MAX_MOVE_ATTEMPTS) record.state = 'failed';
      log.push(`fail:${code}`);
      return true;
    },
  };
  const busy = { switch: false, removal: new Set(), pin: false };
  const removed = [];
  const uploads = {
    read: async () => ({ ...upload }),
    switchStorage: async (_id, from, to) => {
      if (busy.switch) return 'busy';
      if (upload.storageBackend === to) return 'switched';
      if (upload.storageBackend !== from || upload.status !== 'available') return 'gone';
      upload.storageBackend = to;
      return 'switched';
    },
  };
  const removal = {
    remove: async (uploadId, backend) => {
      if (busy.removal.has(backend)) return false;
      await blobs.collect(uploadId, true, cancellation, backend);
      removed.push(backend);
      return true;
    },
  };
  const pins = {
    acquire: async () => {
      if (busy.pin) throw new ArkvoryError('busy', 'Content is being reclaimed');
      return { check() {}, release: async () => undefined };
    },
  };
  const states = { state: (backend) => (backend === 'volume-2' ? state : 'accepting') };
  const rehome = new RehomeBlobs(moves, uploads, removal, blobs, states, pins);
  const move = () => ({
    id: randomUUID(),
    uploadId: id,
    from: 'default',
    to: 'volume-2',
    state: record.state,
    generation: record.generation,
  });
  return { blobs, id, upload, log, record, busy, removed, rehome, move, moves, states };
}

async function published(w) {
  await w.blobs.put(w.id, descriptor, once(bytes), cancellation, 'default');
}

test('the move states form one path of repeatable steps', () => {
  assert.deepEqual(
    ['planned', 'copied', 'switched'].map((state) => [stepOf(state), afterStep(state)]),
    [
      ['copy', 'copied'],
      ['switch', 'switched'],
      ['release', 'released'],
    ],
  );
  const state = (id) =>
    ({ default: 'accepting', 'volume-2': 'accepting', ro: 'read_only' })[id] ?? 'not_loaded';
  requireMove('default', 'volume-2', state);
  requireMove('ro', 'default', state);
  assert.throws(() => requireMove('default', 'default', state), { code: 'invalid_input' });
  assert.throws(() => requireMove('default', 'gone', state), { reason: 'backend_unknown' });
  assert.throws(() => requireMove('default', 'ro', state), { reason: 'backend_read_only' });
  assert.throws(() => requireMove('Default', 'volume-2', state), { code: 'invalid_input' });
});

test('planning checks both storages, the repository and the limit', async () => {
  const states = {
    state: (id) =>
      id === 'volume-2' ? 'unavailable' : id === 'default' ? 'accepting' : 'not_loaded',
  };
  const store = { plan: async (plan) => plan.limit };
  // A target not opened in this process yet is checked by the worker again.
  assert.equal(
    await planRehome(store, states, {
      from: 'default',
      to: 'volume-2',
      repository: null,
      limit: 3,
    }),
    3,
  );
  await assert.rejects(
    planRehome(store, states, { from: 'default', to: 'volume-2', repository: 'Bad', limit: 1 }),
    { code: 'invalid_input' },
  );
  await assert.rejects(
    planRehome(store, states, { from: 'default', to: 'volume-2', repository: null, limit: 0 }),
    { code: 'invalid_input' },
  );
});

test('a move copies, switches and releases; the source copy is gone, the target has the bytes', async () => {
  const w = world();
  await published(w);
  const run = await w.rehome.run(w.move(), cancellation);
  assert.deepEqual(run, { outcome: 'done', state: 'released' });
  assert.deepEqual(w.log, ['copied', 'switched', 'released']);
  assert.equal(w.upload.storageBackend, 'volume-2');
  await assert.rejects(w.blobs.exists(w.id, bytes.length, 'default'), { code: 'unavailable' });
  await w.blobs.verify(w.id, descriptor, cancellation, 'volume-2');
});

test('every step repeats after a crash: copy again, switch already done, release again', async () => {
  const w = world();
  await published(w);
  // Crash after the copy, before its record: the copy is verified and kept.
  await w.blobs.put(w.id, descriptor, once(bytes), cancellation, 'volume-2');
  // Crash after the switch, before its record: the row already names the target.
  w.upload.storageBackend = 'volume-2';
  assert.deepEqual(await w.rehome.run(w.move(), cancellation), {
    outcome: 'done',
    state: 'released',
  });
  assert.deepEqual(w.log, ['copied', 'switched', 'released']);
  await w.blobs.verify(w.id, descriptor, cancellation, 'volume-2');
});

test('busy locks defer a step without counting an attempt', async () => {
  const w = world();
  await published(w);
  w.busy.pin = true;
  assert.equal((await w.rehome.run(w.move(), cancellation)).outcome, 'deferred');
  w.busy.pin = false;
  w.busy.switch = true;
  assert.deepEqual(await w.rehome.run(w.move(), cancellation), {
    outcome: 'deferred',
    state: 'copied',
  });
  w.busy.switch = false;
  // A download or a backup pin holds the source: the switch is done, the release waits.
  w.busy.removal.add('default');
  assert.deepEqual(await w.rehome.run(w.move(), cancellation), {
    outcome: 'deferred',
    state: 'switched',
  });
  await w.blobs.verify(w.id, descriptor, cancellation, 'default');
  w.busy.removal.clear();
  assert.deepEqual(await w.rehome.run(w.move(), cancellation), {
    outcome: 'done',
    state: 'released',
  });
  assert.equal(w.record.attempts, 0);
});

test('an upload no longer published is skipped and its copy in the target removed', async () => {
  const w = world();
  await published(w);
  assert.deepEqual(await w.rehome.step(w.move(), cancellation), {
    kind: 'advanced',
    state: 'copied',
  });
  w.upload.status = 'cancelled';
  assert.deepEqual(await w.rehome.run(w.move(), cancellation), {
    outcome: 'done',
    state: 'skipped',
  });
  assert.deepEqual(w.removed, ['volume-2']);
  await assert.rejects(w.blobs.exists(w.id, bytes.length, 'volume-2'), { code: 'unavailable' });
  // The source is left to the core's cleanup, which follows the upload's own storage.
  await w.blobs.verify(w.id, descriptor, cancellation, 'default');
});

test('a target that takes no data ends the move; repeated failures end it after five attempts', async () => {
  const closed = world({ state: 'read_only' });
  await published(closed);
  assert.equal((await closed.rehome.run(closed.move(), cancellation)).outcome, 'failed');
  assert.deepEqual([closed.record.state, closed.record.error], ['failed', 'backend_read_only']);
  const broken = world();
  // Nothing published in the source: every copy fails with unavailable.
  for (let attempt = 1; attempt <= MAX_MOVE_ATTEMPTS; attempt++)
    assert.equal((await broken.rehome.run(broken.move(), cancellation)).outcome, 'failed');
  assert.deepEqual([broken.record.state, broken.record.attempts], ['failed', MAX_MOVE_ATTEMPTS]);
});

test('a lost lease stops the move: the stale holder writes nothing', async () => {
  const w = world();
  await published(w);
  const stale = w.move();
  w.record.generation++;
  assert.deepEqual(await w.rehome.run(stale, cancellation), { outcome: 'lost', state: 'planned' });
  assert.equal(w.record.state, 'planned');
  // A stopping worker is not a failure of the move.
  const stopping = {
    throwIfAborted() {
      throw new ArkvoryError('unavailable', 'stopping');
    },
  };
  await assert.rejects(w.rehome.run(w.move(), stopping));
  assert.equal(w.record.attempts, 0);
});

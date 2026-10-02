import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { CaptureBackup, backupFailureOf } from '@proanima/arkvory-application';

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** In-memory ports that record the order of every protocol step. */
function ports(options = {}) {
  const events = [];
  const files = new Map();
  const entries = [0, 1, 2, 3, 4].map((index) => ({
    id: randomUUID(),
    size: 1,
    sha256: sha(String(index)),
  }));
  const pages = [entries.slice(0, 2), entries.slice(2, 4), entries.slice(4), []];
  const lease = {
    jobId: randomUUID(),
    pointId: randomUUID(),
    generation: 1,
    attempt: 1,
    throwIfAborted() {},
    async close() {
      events.push('lease.close');
    },
  };
  const session = {
    takenAt: '2026-10-02T08:00:00.000Z',
    exportedId: '00000004-0000001B-1',
    schemaVersion: 25,
    postgresMajor: 18,
    sourceInstanceId: randomUUID(),
    pendingUploads: 1,
    tables: ['arkvory_users', 'arkvory_uploads'],
    excludedTables: [{ name: 'arkvory_user_sessions', reason: 'ephemeral sessions' }],
    async inventory() {
      events.push('inventory.page');
      return pages.shift() ?? [];
    },
    async *rows(table) {
      events.push('rows:' + table);
      yield JSON.stringify({ table });
    },
    async close() {
      if (!events.includes('snapshot.close')) events.push('snapshot.close');
    },
  };
  const deps = {
    jobs: {
      async start() {
        return { kind: 'started', lease };
      },
      async advance(_lease, phase) {
        events.push('advance:' + phase);
      },
      async committing() {
        events.push('committing');
      },
      async complete() {
        events.push('complete');
      },
      async fail(_lease, code) {
        events.push('fail:' + code);
      },
    },
    barrier: {
      async close() {
        events.push('barrier.close');
      },
      async reopen() {
        events.push('barrier.reopen');
      },
    },
    pins: {
      async pin(_lease, ids) {
        events.push('pin:' + ids.join(','));
      },
    },
    snapshots: {
      async open() {
        events.push('snapshot.open');
        return session;
      },
    },
    content: {
      async *read(entry) {
        events.push('read:' + entry.id);
        yield Buffer.from(String(entries.indexOf(entry)));
      },
    },
    vault: {
      async identity() {
        return { vaultId: randomUUID() };
      },
      async point() {
        return null;
      },
      async stage() {
        return {
          async write(name, lines) {
            const written = [];
            for await (const line of lines) {
              if (name === 'inventory.ndjson') events.push('entry:' + JSON.parse(line).id);
              written.push(line);
            }
            files.set(name, written);
            return { sha256: sha(written.join('\n')), bytes: '10', lines: written.length };
          },
          async *lines(name) {
            yield* files.get(name);
          },
          async commit() {
            events.push('commit');
            if (options.commitFails) throw new ArkvoryError('unavailable', 'Injected');
            return 'committed';
          },
          async discard() {
            events.push('discard');
          },
        };
      },
      async hasBlob() {
        return false;
      },
      async putBlob(entry, source) {
        for await (const chunk of source) assert.ok(chunk);
        events.push('copy:' + entry.id);
      },
    },
    identity: { next: () => randomUUID(), now: () => new Date().toISOString() },
    release: { version: 'dev', commit: null },
  };
  return { deps, events, entries };
}

const at = (events, name) => {
  const index = events.indexOf(name);
  assert.notEqual(index, -1, `missing ${name}`);
  return index;
};

test('capture pins every entry before listing it and copies only after T is closed', async () => {
  const { deps, events, entries } = ports();
  const result = await new CaptureBackup(deps).run('protocol');
  assert.equal(result.outcome, 'created');
  assert.equal(result.blobs, entries.length);
  assert.ok(at(events, 'barrier.close') < at(events, 'snapshot.open'));
  for (const [index, entry] of entries.entries()) {
    const pin = events.findIndex((event) => event.startsWith('pin:') && event.includes(entry.id));
    assert.ok(pin !== -1 && pin < at(events, 'entry:' + entry.id), `entry ${index} before its pin`);
    assert.ok(at(events, 'entry:' + entry.id) < at(events, 'barrier.reopen'));
  }
  assert.ok(at(events, 'barrier.reopen') < at(events, 'rows:arkvory_users'));
  const firstRead = events.findIndex((event) => event.startsWith('read:'));
  assert.ok(at(events, 'snapshot.close') < firstRead, 'content copied while T was open');
  assert.ok(at(events, 'advance:blobs') < firstRead);
  assert.ok(at(events, 'committing') < at(events, 'commit'));
  assert.ok(at(events, 'commit') < at(events, 'complete'));
  assert.ok(!events.some((event) => event.startsWith('fail:')));
  assert.equal(events.at(-1), 'lease.close');
});

test('a failure before committing is recorded; after committing it is left to reconciliation', async () => {
  const before = ports();
  before.deps.content = {
    async *read() {
      yield Buffer.alloc(0);
      throw new ArkvoryError('integrity_mismatch', 'Injected');
    },
  };
  await assert.rejects(new CaptureBackup(before.deps).run('before'), {
    code: 'integrity_mismatch',
  });
  assert.ok(before.events.includes('fail:integrity_mismatch'));
  assert.ok(before.events.includes('discard'));
  const after = ports({ commitFails: true });
  await assert.rejects(new CaptureBackup(after.deps).run('after'), { code: 'unavailable' });
  assert.ok(!after.events.some((event) => event.startsWith('fail:')));
  assert.ok(!after.events.includes('complete'));
  assert.equal(backupFailureOf(new Error('x')).code, 'unexpected');
  assert.equal(backupFailureOf(new ArkvoryError('capacity_exceeded', 'x')).code, 'storage_full');
});

test('capture refuses an invalid idempotency key before touching any port', async () => {
  const { deps, events } = ports();
  await assert.rejects(new CaptureBackup(deps).run('no spaces allowed'), {
    code: 'invalid_argument',
  });
  assert.deepEqual(events, []);
  assert.throws(() => new CaptureBackup({ ...deps, limits: { inventoryBatch: 0 } }), {
    code: 'invalid_argument',
  });
});

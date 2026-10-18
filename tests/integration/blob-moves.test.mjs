import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RehomeBlobs, StorageService, planRehome } from '@proanima/arkvory-application';
import {
  LocalBlobStore,
  PostgresBlobMoves,
  PostgresContentPins,
  PostgresCopyRemoval,
  PostgresUploadSwitch,
  StorageBackends,
  takeRehomeSingleton,
} from '@proanima/arkvory-infrastructure';
import { Pool } from 'pg';
import { removeTestDirectory } from '../helpers.mjs';
import { rehomeBytesPerSecond, runRehome } from '../../apps/worker/dist/rehome-loop.js';
import { setup } from './fixture.mjs';

// Moving published blobs between two volumes on PostgreSQL (ADR 0083, N2): crash after each
// step, a download and a backup pin during the move, an upload cancelled meanwhile, a lost
// lease, the singleton lock and the planning of moves.
const principal = {
  credential: 'file-key',
  id: 'test-writer',
  repositories: ['releases'],
  permissions: ['read', 'write'],
};
const cancellation = { throwIfAborted() {} };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* once(bytes) {
  yield bytes;
}

async function scratch(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

async function moving(t) {
  const f = await setup(t);
  const core = new LocalBlobStore(await scratch(t, 'arkvory-move-core-'), 0);
  const second = new LocalBlobStore(await scratch(t, 'arkvory-move-v2-'), 0);
  for (const store of [core, second]) await store.initialize();
  const instance = (id, store) => ({
    id,
    blobs: store,
    lifecycle: store,
    mode: 'full',
    acceptsWrites: true,
    enabled: true,
  });
  const blobs = new StorageBackends([instance('default', core), instance('volume-2', second)]);
  blobs.mark('volume-2', null, await second.identity());
  // Pins on a pool of their own: the fixture closes its pools before this test's hooks run.
  const pool = new Pool({ connectionString: f.config.databaseUrl });
  const pins = new PostgresContentPins(pool);
  t.after(async () => {
    await pins.close();
    await pool.end();
  });
  const moves = new PostgresBlobMoves(f.catalog.pool);
  const switcher = new PostgresUploadSwitch(f.catalog.pool);
  const rehome = new RehomeBlobs(
    moves,
    switcher,
    new PostgresCopyRemoval(f.catalog.pool, blobs),
    blobs,
    blobs,
    pins,
  );
  const storage = new StorageService(f.catalog, blobs, {
    next: randomUUID,
    now: () => new Date().toISOString(),
  });
  const publish = async () => {
    const bytes = randomBytes(4096);
    const descriptor = {
      name: 'a.bin',
      size: String(bytes.length),
      sha256: sha(bytes),
      labels: [],
      metadata: {},
    };
    const upload = await storage.create(principal, 'releases', randomUUID(), descriptor);
    await storage.upload(principal, 'releases', upload.id, once(bytes), cancellation);
    return { id: upload.id, bytes };
  };
  const plan = (extra = {}) =>
    planRehome(moves, blobs, {
      from: 'default',
      to: 'volume-2',
      repository: null,
      limit: 100,
      ...extra,
    });
  const row = async (id) =>
    (
      await f.catalog.pool.query(
        `SELECT u.storage_backend, m.state, m.attempts FROM arkvory_uploads u
         LEFT JOIN arkvory_blob_moves m ON m.upload_id=u.id WHERE u.id=$1 ORDER BY m.created_at DESC LIMIT 1`,
        [id],
      )
    ).rows[0];
  const expire = () =>
    f.catalog.pool.query("UPDATE arkvory_blob_moves SET lease_until=now()-interval '1 second'");
  const claimOne = async () => {
    await expire();
    const [move] = await moves.claim(1);
    assert.ok(move, 'a move to claim');
    return move;
  };
  return {
    f,
    core,
    second,
    blobs,
    pins,
    moves,
    switcher,
    rehome,
    storage,
    publish,
    plan,
    row,
    claimOne,
  };
}

const gather = async (source) => {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

test('a planned move copies, switches and releases; planning twice adds no move', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  assert.equal(await m.plan(), 1);
  assert.equal(await m.plan(), 0, 'one active move per upload');
  const run = await m.rehome.run(await m.claimOne(), cancellation);
  assert.deepEqual(run, { outcome: 'done', state: 'released' });
  assert.deepEqual(await m.row(id), {
    storage_backend: 'volume-2',
    state: 'released',
    attempts: 0,
  });
  await assert.rejects(m.core.exists(id, bytes.length), { code: 'unavailable' });
  assert.deepEqual(await gather(m.blobs.read(id, bytes.length, undefined, 'volume-2')), bytes);
  // The logical accounting does not change: the bytes stay one upload of the repository.
  const counted = await m.f.catalog.pool.query(
    `SELECT sum(bytes)::text AS bytes FROM arkvory_upload_bytes WHERE repository='releases'`,
  );
  assert.equal(counted.rows[0].bytes, String(bytes.length));
  assert.deepEqual(await m.moves.counts(), { released: 1 });
});

test('a crash after each step repeats only that step', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  await m.plan();
  // Crash after the copy, before its record: the next claim copies again over a verified copy.
  const descriptor = (await m.storage.status(principal, 'releases', id)).descriptor;
  await m.blobs.put(id, descriptor, once(bytes), cancellation, 'volume-2');
  assert.deepEqual(await m.rehome.step(await m.claimOne(), cancellation), {
    kind: 'advanced',
    state: 'copied',
  });
  // Crash after the switch, before its record.
  assert.equal(await m.switcher.switchStorage(id, 'default', 'volume-2'), 'switched');
  assert.deepEqual(await m.rehome.step(await m.claimOne(), cancellation), {
    kind: 'advanced',
    state: 'switched',
  });
  // Crash after the release, before its record: removing again is harmless.
  await m.blobs.collect(id, true, cancellation, 'default');
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'done',
    state: 'released',
  });
  assert.deepEqual(await gather(m.blobs.read(id, bytes.length, undefined, 'volume-2')), bytes);
});

test('a download begun before the switch finishes from the source; the release waits for it', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  await m.plan();
  const pin = await m.pins.acquire(id);
  const reading = m.blobs.read(id, bytes.length, undefined, 'default');
  const run = await m.rehome.run(await m.claimOne(), cancellation);
  assert.deepEqual(run, { outcome: 'deferred', state: 'switched' });
  assert.deepEqual(
    await gather(reading),
    bytes,
    'the started download reads the source to the end',
  );
  await pin.release();
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'done',
    state: 'released',
  });
  await assert.rejects(m.core.exists(id, bytes.length), { code: 'unavailable' });
});

test('a backup pin and a closed barrier keep the source until the copy point is done', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  await m.plan();
  const job = randomUUID();
  await m.f.catalog.pool.query(
    `INSERT INTO arkvory_backup_jobs(id,kind,state,phase,idempotency_key,vault_id,point_id)
     VALUES ($1,'capture','failed','blobs',$2,$3,$4)`,
    [job, randomUUID(), randomUUID(), randomUUID()],
  );
  await m.f.catalog.pool.query(
    'INSERT INTO arkvory_backup_pins(upload_id, job_id) VALUES ($1,$2)',
    [id, job],
  );
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'deferred',
    state: 'switched',
  });
  await m.core.exists(id, bytes.length);
  await m.f.catalog.pool.query('DELETE FROM arkvory_backup_pins WHERE job_id=$1', [job]);
  await m.f.catalog.pool.query(
    `UPDATE arkvory_backup_barrier SET state='closed', job_id=$1, generation=1`,
    [job],
  );
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'deferred',
    state: 'switched',
  });
  await m.f.catalog.pool.query(
    `UPDATE arkvory_backup_barrier SET state='open', job_id=NULL, generation=NULL`,
  );
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'done',
    state: 'released',
  });
});

test('an upload cancelled before the switch is skipped and its copy in the target removed', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  await m.plan();
  assert.deepEqual(await m.rehome.step(await m.claimOne(), cancellation), {
    kind: 'advanced',
    state: 'copied',
  });
  await m.second.exists(id, bytes.length);
  await m.f.catalog.pool.query(
    `UPDATE arkvory_uploads SET status='cancelled', cancelled_at=now() WHERE id=$1`,
    [id],
  );
  assert.deepEqual(await m.rehome.run(await m.claimOne(), cancellation), {
    outcome: 'done',
    state: 'skipped',
  });
  await assert.rejects(m.second.exists(id, bytes.length), { code: 'unavailable' });
  // The source copy belongs to the upload's own storage: the core's cleanup removes it.
  await m.core.exists(id, bytes.length);
});

test('a lost lease writes nothing; a second worker does not run moves beside the first', async (t) => {
  const m = await moving(t);
  await m.publish();
  await m.plan();
  const stale = await m.claimOne();
  const fresh = await m.claimOne();
  assert.ok(fresh.generation > stale.generation);
  assert.deepEqual(await m.rehome.run(stale, cancellation), { outcome: 'lost', state: 'planned' });
  assert.deepEqual(await m.rehome.run(fresh, cancellation), { outcome: 'done', state: 'released' });
  const first = await takeRehomeSingleton(m.f.catalog.sessions);
  assert.ok(first?.active);
  assert.equal(await takeRehomeSingleton(m.f.catalog.sessions), null);
  await first.close();
  const next = await takeRehomeSingleton(m.f.catalog.sessions);
  assert.ok(next);
  await next.close();
});

test('planning refuses unknown storages and a target that takes no data', async (t) => {
  const m = await moving(t);
  await assert.rejects(m.plan({ to: 'volume-9' }), { reason: 'backend_unknown' });
  await assert.rejects(m.plan({ to: 'default', from: 'default' }), { code: 'invalid_input' });
  const readOnly = new StorageBackends([
    {
      id: 'default',
      blobs: m.core,
      lifecycle: m.core,
      mode: 'full',
      acceptsWrites: true,
      enabled: true,
    },
    {
      id: 'volume-2',
      blobs: m.second,
      lifecycle: m.second,
      mode: 'full',
      acceptsWrites: false,
      enabled: true,
    },
  ]);
  readOnly.mark('volume-2', null, await m.second.identity());
  await assert.rejects(
    planRehome(m.moves, readOnly, { from: 'default', to: 'volume-2', repository: null, limit: 1 }),
    { reason: 'backend_read_only' },
  );
});

test('the worker loop performs planned moves under its singleton and stops on request', async (t) => {
  const m = await moving(t);
  const { id, bytes } = await m.publish();
  await m.plan();
  const stop = new AbortController();
  const lines = [];
  const catalog = { pool: m.f.catalog.pool, sessions: m.f.catalog.sessions, active: true };
  const loop = runRehome({
    catalog,
    blobs: m.blobs,
    stop: stop.signal,
    diagnostics: { write: (line) => lines.push(line.code) },
    bytesPerSecond: 0,
  });
  for (let waited = 0; (await m.row(id)).state !== 'released' && waited < 100; waited++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  stop.abort();
  await loop;
  assert.equal((await m.row(id)).state, 'released');
  assert.ok(lines.includes('storage.move_completed'), lines.join());
  assert.deepEqual(await gather(m.blobs.read(id, bytes.length, undefined, 'volume-2')), bytes);
  assert.equal(rehomeBytesPerSecond(undefined), 0);
  assert.throws(() => rehomeBytesPerSecond('1e6'), /ARKVORY_REHOME_BYTES_PER_SECOND/);
});

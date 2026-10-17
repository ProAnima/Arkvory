import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { PostgresEventLog } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
import { runEventSequencer } from '../../apps/worker/dist/event-loop.js';

const writer = 'events-' + randomUUID() + randomUUID();
const reader = 'events-read-' + randomUUID() + randomUUID();
const keys = [
  {
    sha256: createHash('sha256').update(writer).digest('hex'),
    principal: {
      id: 'events-writer',
      repositories: ['releases', 'other'],
      permissions: ['read', 'write'],
      administrator: true,
      serviceAdministrator: true,
    },
  },
  {
    sha256: createHash('sha256').update(reader).digest('hex'),
    principal: { id: 'events-reader', repositories: ['releases'], permissions: ['read'] },
  },
];
const auth = { authorization: `Bearer ${writer}` };
const readOnly = { authorization: `Bearer ${reader}` };

async function publish(f, repository, text, labels = ['ci']) {
  const bytes = Buffer.from(text);
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repository}/uploads`,
    headers: { ...auth, 'idempotency-key': randomUUID() },
    payload: {
      name: `${text}.bin`,
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels,
      metadata: { secret: 'never-in-events' },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repository}/uploads/${id}/content`,
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  return id;
}

async function events(f, query = {}, headers = auth) {
  const search = new URLSearchParams(query).toString();
  const response = await f.app.inject({
    url: `/api/v1/events${search ? `?${search}` : ''}`,
    headers,
  });
  validateResponse('/api/v1/events', 'GET', response);
  return response;
}
const page = async (f, query, headers) => {
  const response = await events(f, query, headers);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
};

test('catalog changes write events in their transaction; the sequencer numbers them in order', async (t) => {
  const f = await setup(t, { keys });
  const log = new PostgresEventLog(f.catalog.pool);
  const first = await publish(f, 'releases', 'one');
  const stage = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/releases/artifacts/${first}/stages/release`,
    headers: auth,
  });
  assert.equal(stage.statusCode, 200, stage.body);
  // Committed, but without a position until the sequencer runs: readers see nothing yet.
  assert.deepEqual((await page(f)).items, []);
  assert.equal(await log.sequence(), 2);
  assert.equal(await log.sequence(), 0);
  const body = await page(f);
  assert.deepEqual(
    body.items.map((event) => [event.type, event.arkvoryposition]),
    [
      ['arkvory.artifact.published.v1', '1'],
      ['arkvory.stage.added.v1', '2'],
    ],
  );
  const [published, staged] = body.items;
  assert.equal(published.id, `${body.epoch}:1`);
  assert.equal(published.source, '/arkvory/arkvory/repositories/releases');
  assert.equal(published.partitionkey, 'repository:releases');
  assert.equal(published.subject, first);
  assert.equal(published.data.size, '3');
  assert.deepEqual(published.data.labels, ['ci']);
  assert.equal(staged.data.stage, 'release');
  assert.deepEqual(staged.data.stages, ['release']);
  // Metadata values, the actor and secrets never enter an event.
  assert.doesNotMatch(JSON.stringify(body), /never-in-events|events-writer/);
  assert.equal(body.next, `${body.epoch}:2`);
  assert.equal(body.head, '2');
  assert.equal(body.oldest, '0');
  assert.deepEqual((await page(f, { after: body.next })).items, []);
  const types = await f.app.inject({ url: '/api/v1/events/types', headers: readOnly });
  validateResponse('/api/v1/events/types', 'GET', types);
  assert.ok(types.json().items.some((type) => type.name === 'artifact.published'));
});

test('a change that rolls back leaves no event', async (t) => {
  const f = await setup(t, { keys });
  const id = await publish(f, 'releases', 'kept');
  await f.catalog.pool.query(
    `CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN IF NEW.type='annotation.updated' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$;
     CREATE TRIGGER reject_event BEFORE INSERT ON arkvory_events FOR EACH ROW EXECUTE FUNCTION reject_event()`,
  );
  const annotate = () =>
    f.app.inject({
      method: 'PUT',
      url: `/api/v1/repositories/releases/artifacts/${id}/annotations`,
      headers: auth,
      payload: { expectedRevision: 0, value: { labels: ['x'], metadata: {}, collections: [] } },
    });
  assert.equal((await annotate()).statusCode, 500);
  const audit = await f.catalog.pool.query(
    "SELECT count(*)::int AS n FROM arkvory_audit WHERE action='annotations.replace'",
  );
  assert.equal(audit.rows[0].n, 0, 'the change and its journal row rolled back with the event');
  await f.catalog.pool.query('DROP TRIGGER reject_event ON arkvory_events');
  assert.equal((await annotate()).statusCode, 200);
  await new PostgresEventLog(f.catalog.pool).sequence();
  assert.deepEqual(
    (await page(f)).items.map((event) => [event.type, event.data.labels]),
    [
      ['arkvory.artifact.published.v1', ['ci']],
      ['arkvory.annotation.updated.v1', ['x']],
    ],
  );
});

test('an event committed later than a newer one is numbered later and never skipped', async (t) => {
  const f = await setup(t, { keys });
  const log = new PostgresEventLog(f.catalog.pool);
  const insert = (client, repository) =>
    client.query(
      `INSERT INTO arkvory_events(type,schema_version,scope,repository,partition_key,subject,data)
       VALUES('artifact.published',1,'repository',$1,'repository:'||$1,$2,$3)`,
      [repository, randomUUID(), JSON.stringify({ repository, artifactId: randomUUID() })],
    );
  // Writers of their own: an open transaction must not hold a connection of the server's pool.
  const writers = new Pool({ connectionString: f.config.databaseUrl, max: 2 });
  const slow = await writers.connect();
  t.after(async () => {
    slow.release();
    await writers.end();
  });
  // Writer A takes the smaller id but commits after writer B.
  await slow.query('BEGIN');
  await insert(slow, 'other');
  const fast = await writers.connect();
  await fast.query('BEGIN');
  await insert(fast, 'releases');
  await fast.query('COMMIT');
  fast.release();
  assert.equal(await log.sequence(), 1);
  const before = await page(f);
  assert.deepEqual(
    before.items.map((e) => [e.arkvoryposition, e.data.repository]),
    [['1', 'releases']],
  );
  await slow.query('COMMIT');
  assert.equal(await log.sequence(), 1);
  const after = await page(f, { after: before.next });
  assert.deepEqual(
    after.items.map((e) => [e.arkvoryposition, e.data.repository]),
    [['2', 'other']],
  );
});

test('a sequencer that fails mid-batch leaves no position; the retry keeps the id order', async (t) => {
  const f = await setup(t, { keys });
  const log = new PostgresEventLog(f.catalog.pool);
  await publish(f, 'releases', 'a');
  await publish(f, 'other', 'b');
  await publish(f, 'releases', 'c');
  await f.catalog.pool.query(
    `CREATE FUNCTION fail_head() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'crash before commit'; END $$;
     CREATE TRIGGER fail_head BEFORE UPDATE ON arkvory_event_state FOR EACH ROW EXECUTE FUNCTION fail_head()`,
  );
  await assert.rejects(log.sequence(), /crash before commit/);
  const unnumbered = await f.catalog.pool.query(
    'SELECT count(*)::int AS n FROM arkvory_events WHERE position IS NULL',
  );
  assert.equal(unnumbered.rows[0].n, 3);
  await f.catalog.pool.query('DROP TRIGGER fail_head ON arkvory_event_state');
  assert.equal(await log.sequence(2), 2);
  assert.equal(await log.sequence(2), 1);
  const rows = await f.catalog.pool.query(
    "SELECT position::int, data->>'name' AS name FROM arkvory_events ORDER BY id",
  );
  assert.deepEqual(
    rows.rows.map((row) => [row.position, row.name]),
    [
      [1, 'a.bin'],
      [2, 'b.bin'],
      [3, 'c.bin'],
    ],
  );
});

test('readers see the repositories they may list; the cursor moves past invisible events', async (t) => {
  const f = await setup(t, { keys });
  await publish(f, 'other', 'hidden-1');
  await publish(f, 'other', 'hidden-2');
  await publish(f, 'releases', 'shown');
  await new PostgresEventLog(f.catalog.pool).sequence();
  const all = await page(f);
  assert.equal(all.items.length, 3);
  const narrow = await page(f, {}, readOnly);
  assert.deepEqual(
    narrow.items.map((e) => e.data.name),
    ['shown.bin'],
  );
  assert.equal(narrow.next, `${narrow.epoch}:3`);
  // Only the hidden events follow the first one: the reader still moves to the end.
  const tail = await page(
    f,
    { after: `${narrow.epoch}:0`, limit: '1', types: 'artifact.*' },
    readOnly,
  );
  assert.deepEqual(
    tail.items.map((e) => e.arkvoryposition),
    ['3'],
  );
  const filtered = await page(f, { repository: 'other' });
  assert.deepEqual(
    filtered.items.map((e) => e.data.name),
    ['hidden-1.bin', 'hidden-2.bin'],
  );
  assert.equal((await events(f, { repository: 'other' }, readOnly)).statusCode, 403);
  assert.equal((await events(f, { types: 'artifact.unknown' })).statusCode, 400);
  assert.equal((await events(f, { after: '5' })).statusCode, 400);
  assert.equal((await events(f, { after: `${all.epoch}:9` })).statusCode, 400);
  assert.equal((await events(f, { limit: '501' })).statusCode, 400);
});

test('a revoked permission hides events at once', async (t) => {
  const f = await setup(t, { keys });
  await publish(f, 'releases', 'visible');
  await new PostgresEventLog(f.catalog.pool).sequence();
  const url = await f.listen();
  const root = new ArkvoryClient(url, () => writer);
  const bindings = [
    { resource: { kind: 'repository', id: 'releases' }, actions: ['artifact.list'] },
  ];
  const account = await root.createServiceAccount('event-reader', bindings);
  const issued = await root.issueServiceKey(account.id, 'event-reader', {
    name: 'events',
    bindings,
  });
  const client = new ArkvoryClient(url, () => issued.secret);
  await client.activateServiceKey();
  assert.equal((await client.events.list()).items.length, 1);
  await root.setServicePolicy(account.id, 1, []);
  assert.deepEqual((await client.events.list()).items, []);
});

test('an expired cursor answers 410 and a restored epoch 409, both with the current window', async (t) => {
  const f = await setup(t, { keys });
  const log = new PostgresEventLog(f.catalog.pool);
  for (const name of ['a', 'b', 'c', 'd']) await publish(f, 'releases', name);
  await log.sequence();
  const start = await page(f, { limit: '1' });
  // Older than the window: everything over two rows goes, in position order.
  assert.equal(await log.prune({ hours: 168, maxRows: 2n }), 2);
  assert.equal(await log.prune({ hours: 168, maxRows: 2n }), 0);
  const expired = await events(f, { after: start.next });
  assert.equal(expired.statusCode, 410);
  assert.equal(expired.json().code, 'gone');
  assert.equal(expired.json().reason, 'events_cursor_expired');
  assert.deepEqual(expired.json().events, { epoch: start.epoch, oldest: '2', head: '4' });
  const resumed = await page(f, { after: `${start.epoch}:2` });
  assert.deepEqual(
    resumed.items.map((e) => e.arkvoryposition),
    ['3', '4'],
  );
  assert.equal((await page(f)).items[0].arkvoryposition, '3', 'without a cursor: from oldest');
  // A restore starts a new epoch; every cursor of the old one is refused.
  const epoch = randomUUID();
  await f.catalog.pool.query('UPDATE arkvory_event_state SET epoch=$1', [epoch]);
  const changed = await events(f, { after: resumed.next });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().reason, 'events_epoch_changed');
  assert.equal(changed.json().events.epoch, epoch);
  // Retention by age: events older than the hours go, a recent one stays.
  await f.catalog.pool.query(
    "UPDATE arkvory_events SET occurred_at=now() - interval '3 hours' WHERE position=3",
  );
  assert.equal(await log.prune({ hours: 2, maxRows: 100n }), 1);
  const snapshot = await log.snapshot();
  assert.deepEqual(
    [snapshot.head, snapshot.oldest, snapshot.prunedTotal, snapshot.unsequencedAgeSeconds],
    [4n, 3n, 3n, 0],
  );
  // A stopped sequencer: the oldest waiting event ages past the 120 s of
  // ArkvoryEventSequencerStalled (deploy/monitoring/arkvory-alerts.yml).
  await publish(f, 'releases', 'waiting');
  await f.catalog.pool.query(
    "UPDATE arkvory_events SET occurred_at=now() - interval '3 minutes' WHERE position IS NULL",
  );
  assert.ok((await log.snapshot()).unsequencedAgeSeconds > 120);
});

test('the worker loop numbers new events and stops with storage ownership', async (t) => {
  const f = await setup(t, { keys });
  await publish(f, 'releases', 'first');
  await publish(f, 'releases', 'second');
  let active = true;
  const catalog = {
    pool: f.catalog.pool,
    get active() {
      return active;
    },
  };
  const stop = new AbortController();
  t.after(() => stop.abort());
  const records = [];
  const loop = runEventSequencer({
    catalog,
    retention: { hours: 168, maxRows: 1000n },
    stop: stop.signal,
    diagnostics: { write: (record) => records.push(record) },
    tickMs: 10,
  });
  const positioned = async (count) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const result = await f.catalog.pool.query(
        'SELECT count(*)::int AS n FROM arkvory_events WHERE position IS NOT NULL',
      );
      if (result.rows[0].n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`fewer than ${count} events numbered`);
  };
  await positioned(2);
  await publish(f, 'releases', 'third');
  await positioned(3);
  // Ownership passes to another worker: this loop ends without numbering anything more.
  active = false;
  await loop;
  await publish(f, 'releases', 'fourth');
  const pending = await f.catalog.pool.query(
    'SELECT count(*)::int AS n FROM arkvory_events WHERE position IS NULL',
  );
  assert.equal(pending.rows[0].n, 1);
  assert.deepEqual(records, []);
  assert.deepEqual(
    (await page(f)).items.map((e) => e.data.name),
    ['first.bin', 'second.bin', 'third.bin'],
  );
});

test('arkvoryctl events tail prints JSON lines and goes on from its cursor file', async (t) => {
  const f = await setup(t, { keys });
  const server = (await f.listen()) + '/';
  const log = new PostgresEventLog(f.catalog.pool);
  await publish(f, 'releases', 'one');
  await publish(f, 'other', 'two');
  await log.sequence();
  const cursorFile = join(f.directory, 'events.cursor');
  const env = { ...process.env, ARKVORY_CLI_HOME: join(f.directory, 'cli') };
  for (const key of ['ARKVORY_TOKEN_FILE']) delete env[key];
  const run = (...args) =>
    promisify(execFile)(
      process.execPath,
      [resolve('apps/cli/dist/main.js'), 'events', 'tail', '--cursor-file', cursorFile, ...args],
      {
        env: { ...env, ARKVORY_BASE_URL: server, ARKVORY_TOKEN: writer },
        windowsHide: true,
        timeout: 30000,
      },
    );
  const lines = (output) =>
    output
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  // Pages of one event: the command reads until it reaches the newest one.
  const first = lines((await run('--limit', '1')).stdout);
  assert.deepEqual(
    first.map((e) => e.data.name),
    ['one.bin', 'two.bin'],
  );
  const saved = JSON.parse(await readFile(cursorFile, 'utf8')).cursor;
  assert.equal(saved, first[1].id);
  await publish(f, 'releases', 'three');
  await log.sequence();
  assert.deepEqual(
    lines((await run()).stdout).map((e) => e.data.name),
    ['three.bin'],
  );
  assert.deepEqual(lines((await run('--repository', 'other')).stdout), []);
  // An expired cursor ends the command with the conflict exit code and the server's reason.
  await writeFile(cursorFile, JSON.stringify({ cursor: `${first[0].arkvoryepoch}:0` }));
  await f.catalog.pool.query('UPDATE arkvory_event_state SET pruned_through=2');
  const failed = await run('--json').then(
    () => assert.fail('an expired cursor must fail'),
    (error) => error,
  );
  assert.equal(failed.code, 6);
  assert.equal(JSON.parse(failed.stderr).error.reason, 'events_cursor_expired');
});

test('events tail reads past a bounded scan without visible events to the newest one', async (t) => {
  const f = await setup(t, { keys });
  const server = (await f.listen()) + '/';
  const log = new PostgresEventLog(f.catalog.pool);
  // More hidden events than one read scans (5000), then one the reader may see.
  await f.catalog.pool.query(
    `INSERT INTO arkvory_events(type,schema_version,scope,repository,partition_key,subject,data)
     SELECT 'artifact.published',1,'repository','other','repository:other',gen_random_uuid()::text,
       jsonb_build_object('repository','other','artifactId',gen_random_uuid())
     FROM generate_series(1,5001)`,
  );
  await publish(f, 'releases', 'beyond');
  assert.equal(await log.sequence(6000), 5002);
  const first = await page(f, {}, readOnly);
  assert.deepEqual(first.items, []);
  assert.equal(first.next, `${first.epoch}:5000`, 'one read stops at its scan bound');
  const env = { ...process.env, ARKVORY_CLI_HOME: join(f.directory, 'cli') };
  delete env['ARKVORY_TOKEN_FILE'];
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [resolve('apps/cli/dist/main.js'), 'events', 'tail'],
    {
      env: { ...env, ARKVORY_BASE_URL: server, ARKVORY_TOKEN: reader },
      windowsHide: true,
      timeout: 30000,
    },
  );
  assert.deepEqual(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).data.name),
    ['beyond.bin'],
  );
});

test('positions, pages and retention follow numeric order past one digit', async (t) => {
  const f = await setup(t, { keys });
  const log = new PostgresEventLog(f.catalog.pool);
  // Twelve events of one repository in commit order; ids and positions cross 9 → 10.
  await f.catalog.pool.query(
    `INSERT INTO arkvory_events(type,schema_version,scope,repository,partition_key,subject,data)
     SELECT 'artifact.published',1,'repository','releases','repository:releases','e'||n,
       jsonb_build_object('repository','releases','artifactId',gen_random_uuid(),'n',n)
     FROM generate_series(1,12) n ORDER BY n`,
  );
  assert.equal(await log.sequence(), 12);
  const numbered = await f.catalog.pool.query(
    'SELECT subject, position::int FROM arkvory_events ORDER BY id',
  );
  assert.deepEqual(
    numbered.rows.map((row) => [row.subject, row.position]),
    Array.from({ length: 12 }, (_, index) => [`e${index + 1}`, index + 1]),
  );
  const read = [];
  let after;
  for (let pageCount = 0; pageCount < 10; pageCount++) {
    const body = await page(f, { limit: '5', ...(after ? { after } : {}) });
    read.push(...body.items.map((event) => event.subject));
    after = body.next;
    if (body.items.length === 0) break;
  }
  assert.deepEqual(
    read,
    Array.from({ length: 12 }, (_, index) => `e${index + 1}`),
    'pages of five keep position order and skip nothing',
  );
  // Over the row limit by nine: positions 1-9 go, 10-12 stay.
  assert.equal(await log.prune({ hours: 168, maxRows: 3n }), 9);
  const kept = await page(f);
  assert.equal(kept.oldest, '9');
  assert.deepEqual(
    kept.items.map((event) => event.subject),
    ['e10', 'e11', 'e12'],
  );
});

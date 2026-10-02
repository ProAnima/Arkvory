import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SCHEMA_VERSION, migrate } from '@proanima/arkvory-infrastructure';
import { emptySchema, schemaFingerprint } from './schema-fingerprint.mjs';

// Database exactly as the first release left it (migration 1). Historical SQL: never edit.
const firstRelease = `
  CREATE TABLE arkvory_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE arkvory_uploads (
    id uuid PRIMARY KEY,
    repository varchar(64) NOT NULL,
    owner varchar(128) NOT NULL,
    idempotency_key varchar(128) NOT NULL,
    descriptor jsonb NOT NULL,
    size bigint NOT NULL CHECK (size >= 0 AND size <= 5368709120),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','cancelled')),
    created_at timestamptz NOT NULL,
    UNIQUE (repository, owner, idempotency_key)
  );
  CREATE INDEX arkvory_available ON arkvory_uploads(repository, id) WHERE status='available';
  INSERT INTO arkvory_migrations(version) VALUES(1);`;

const upload = (id, status) => [
  id,
  'releases',
  'writer',
  `key-${status}`,
  JSON.stringify({
    name: `${status}.bin`,
    size: '1',
    sha256: createHash('sha256').update(status).digest('hex'),
  }),
  status,
];

test('a first-release database upgrades to exactly the schema of a fresh install', async (t) => {
  const fresh = await emptySchema(t);
  await migrate(fresh);
  const expected = await schemaFingerprint(fresh);
  assert.equal(expected.migrations.at(-1), SCHEMA_VERSION);
  const legacy = await emptySchema(t);
  await legacy.query(firstRelease);
  for (const row of [
    upload('00000000-0000-4000-8000-000000000001', 'available'),
    upload('00000000-0000-4000-8000-000000000002', 'cancelled'),
  ])
    await legacy.query(
      `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
       VALUES($1,$2,$3,$4,$5,1,$6,now())`,
      row,
    );
  await migrate(legacy);
  assert.deepEqual(await schemaFingerprint(legacy), expected);
  // Migration 24 is expand-only: nullable correlation columns without defaults (migration 26
  // adds the same column to backup requests).
  assert.deepEqual(
    (
      await legacy.query(
        `SELECT table_name, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns
         WHERE table_schema=current_schema() AND column_name='request_id' ORDER BY table_name`,
      )
    ).rows,
    ['arkvory_audit', 'arkvory_backup_requests', 'arkvory_jobs', 'arkvory_security_audit'].map(
      (table) => ({
        table_name: table,
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: 128,
      }),
    ),
  );
  // Data steps of historical migrations still run: cancellation time and publication backfill.
  assert.deepEqual(
    (
      await legacy.query(
        `SELECT status, cancelled_at IS NOT NULL AS cancelled, published_at IS NOT NULL AS published
         FROM arkvory_uploads ORDER BY id`,
      )
    ).rows,
    [
      { status: 'available', cancelled: false, published: true },
      { status: 'cancelled', cancelled: true, published: false },
    ],
  );
});

test('repeating migration on a current schema changes neither structure nor history', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  const structure = await schemaFingerprint(pool);
  const history = async () =>
    (await pool.query('SELECT version, applied_at FROM arkvory_migrations ORDER BY version')).rows;
  const applied = await history();
  await migrate(pool);
  assert.deepEqual(await schemaFingerprint(pool), structure);
  assert.deepEqual(await history(), applied);
});

test('migration 25 is expand-only: backup tables and the barrier row, nothing else changes', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool, { upTo: 24 });
  const before = await schemaFingerprint(pool);
  await migrate(pool);
  const after = await schemaFingerprint(pool);
  const unrelated = (row) => !/^arkvory_backup_/.test(row.table ?? row.name);
  for (const part of ['columns', 'constraints', 'indexes', 'triggers', 'functions'])
    assert.deepEqual(after[part].filter(unrelated), before[part], part);
  assert.deepEqual(after.migrations, [...before.migrations, 25, 26]);
  assert.equal(
    (await pool.query('SELECT state FROM arkvory_backup_barrier WHERE singleton')).rows[0].state,
    'open',
  );
});

test('migration 26 is expand-only: new backup tables and defaulted counters on capture jobs', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool, { upTo: 25 });
  const before = await schemaFingerprint(pool);
  // A schema 25 capture job row keeps working: the new columns take constant defaults.
  await pool.query(`INSERT INTO arkvory_backup_jobs(id,kind,state,phase,idempotency_key,vault_id,
      point_id,attempts,generation) VALUES('00000000-0000-4000-8000-000000000001','capture',
      'failed','blobs','legacy','00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',1,1)`);
  await migrate(pool);
  const after = await schemaFingerprint(pool);
  const created = /^arkvory_backup_(plan|agent|requests|points)/;
  const existing = (row) => !created.test(row.table ?? '') && !created.test(row.name ?? '');
  const counters = ['bytes_copied', 'bytes_total', 'blobs_copied', 'blobs_total'];
  assert.deepEqual(
    after.columns.filter(existing).filter((row) => !counters.includes(row.column)),
    before.columns,
  );
  assert.deepEqual(
    after.columns
      .filter((row) => row.table === 'arkvory_backup_jobs' && counters.includes(row.column))
      .map((row) => [row.column, row.not_null, row.default]),
    counters.map((column) => [column, true, '0']),
  );
  for (const part of ['indexes', 'triggers', 'functions'])
    assert.deepEqual(after[part].filter(existing), before[part], part);
  assert.deepEqual(
    after.constraints
      .filter(existing)
      .filter((row) => !/^arkvory_backup_jobs_(bytes|blobs)_/.test(row.name)),
    before.constraints,
  );
  assert.deepEqual(after.migrations, [...before.migrations, 26]);
  assert.deepEqual(
    (await pool.query('SELECT bytes_copied::text, blobs_total::text FROM arkvory_backup_jobs'))
      .rows,
    [{ bytes_copied: '0', blobs_total: '0' }],
  );
  const plan = (await pool.query('SELECT * FROM arkvory_backup_plan')).rows;
  assert.equal(plan.length, 1);
  assert.deepEqual(
    [plan[0].enabled, plan[0].hour, plan[0].minute, plan[0].timezone, plan[0].revision],
    [false, 2, 0, 'UTC', 1],
  );
  assert.deepEqual([plan[0].keep_daily, plan[0].keep_weekly, plan[0].keep_monthly], [7, 4, 6]);
  const agent = (await pool.query('SELECT owner, generation::int FROM arkvory_backup_agent')).rows;
  assert.deepEqual(agent, [{ owner: null, generation: 0 }]);
});

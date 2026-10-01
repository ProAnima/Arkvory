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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  appliedSchemaVersion,
  excludedTables,
  exportedTables,
  migrate,
  presentTablesQuery,
  unregisteredTables,
} from '@proanima/arkvory-infrastructure';
import { emptySchema, schemaFingerprint } from './schema-fingerprint.mjs';

test('every Arkvory table is either exported or excluded with a reason', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  const present = (await pool.query(presentTablesQuery)).rows.map((row) => row.name);
  const registered = [...exportedTables, ...excludedTables].map((table) => table.name);
  assert.deepEqual(unregisteredTables(present), [], 'a migration added an unregistered table');
  assert.deepEqual(
    [...registered].sort(),
    [...present].sort(),
    'the registry names a missing table',
  );
  assert.equal(new Set(registered).size, registered.length);
  for (const table of excludedTables) assert.ok(table.reason.length > 10, table.name);
  await pool.query('CREATE TABLE arkvory_future_feature(id integer)');
  const after = (await pool.query(presentTablesQuery)).rows.map((row) => row.name);
  assert.deepEqual(unregisteredTables(after), ['arkvory_future_feature']);
});

test('the export order is foreign-key safe and keys match the primary keys', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  const order = new Map(exportedTables.map((table, index) => [table.name, index]));
  const references = await pool.query(`SELECT c.relname AS source, p.relname AS target,
      array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid
    JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=ANY(k.conkey)
    WHERE k.contype='f' AND c.relnamespace=current_schema()::regnamespace
    GROUP BY c.relname, p.relname, k.conname`);
  for (const row of references.rows) {
    if (!order.has(row.source)) continue;
    assert.ok(order.has(row.target), `${row.source} references the unexported ${row.target}`);
    const table = exportedTables[order.get(row.source)];
    if (row.source === row.target) {
      // A self-reference is loaded as NULL first; at least one of its columns must be deferred.
      assert.ok(
        row.columns.some((column) => table.deferred?.includes(column)),
        `${row.source} self-reference ${row.columns} is not deferred`,
      );
      continue;
    }
    assert.ok(
      order.get(row.target) < order.get(row.source),
      `${row.source} loads before ${row.target}`,
    );
  }
  const keys = await pool.query(`SELECT c.relname AS name, array_agg(a.attname::text ORDER BY
      array_position(k.conkey, a.attnum)) AS columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=ANY(k.conkey)
    WHERE k.contype='p' AND c.relnamespace=current_schema()::regnamespace GROUP BY c.relname`);
  const primary = new Map(keys.rows.map((row) => [row.name, row.columns]));
  for (const table of exportedTables)
    assert.deepEqual(table.key, primary.get(table.name), table.name);
});

test('a bounded migration stops at its version and the rest reaches the fresh schema', async (t) => {
  const fresh = await emptySchema(t);
  await migrate(fresh);
  const expected = await schemaFingerprint(fresh);
  assert.equal(expected.migrations.at(-1), SCHEMA_VERSION);
  for (const upTo of [13, 24]) {
    const pool = await emptySchema(t);
    await migrate(pool, { upTo });
    assert.equal(await appliedSchemaVersion(pool), upTo);
    const partial = await schemaFingerprint(pool);
    assert.ok(partial.migrations.every((version) => version <= upTo));
    assert.equal(
      (await pool.query("SELECT to_regclass('arkvory_backup_jobs') IS NULL AS absent")).rows[0]
        .absent,
      true,
    );
    await migrate(pool);
    assert.deepEqual(await schemaFingerprint(pool), expected);
  }
  await assert.rejects(migrate(fresh, { upTo: SCHEMA_VERSION + 1 }), /outside the versions/);
  await assert.rejects(migrate(fresh, { upTo: 0 }), /outside the versions/);
});

test('migration 25 starts with an open barrier and no pins or capture jobs', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  assert.deepEqual(
    (await pool.query('SELECT singleton, state, job_id FROM arkvory_backup_barrier')).rows,
    [{ singleton: true, state: 'open', job_id: null }],
  );
  await assert.rejects(
    pool.query("INSERT INTO arkvory_backup_barrier(singleton,state) VALUES(false,'open')"),
    { code: '23514' },
  );
  for (const table of ['arkvory_backup_jobs', 'arkvory_backup_pins'])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
});

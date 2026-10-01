import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/** Pool bound to a new empty schema; the schema is dropped after the test. */
export async function emptySchema(t) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('ARKVORY_TEST_DATABASE_URL is required; use a dedicated test database');
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  const schema = 'arkvory_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return pool;
}

/**
 * Structure of the current schema without its name: columns in physical order, constraints,
 * indexes, triggers, function bodies and applied migration versions. Two databases with equal
 * fingerprints were migrated to the same shape.
 */
export async function schemaFingerprint(pool) {
  const rows = async (sql) => (await pool.query(sql)).rows;
  const unqualified = (column) => `replace(${column}, current_schema() || '.', '')`;
  return {
    columns: await rows(`SELECT c.relname AS table, a.attname AS column,
        format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
        a.attidentity AS identity, ${unqualified('pg_get_expr(d.adbin, d.adrelid)')} AS default
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind IN ('r','p')
        AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname COLLATE "C", a.attnum`),
    constraints: await rows(`SELECT c.relname AS table, k.conname AS name, k.contype AS type,
        ${unqualified('pg_get_constraintdef(k.oid)')} AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace=current_schema()::regnamespace
      ORDER BY c.relname COLLATE "C", k.conname COLLATE "C"`),
    indexes: await rows(`SELECT indexname AS name, ${unqualified('indexdef')} AS definition
      FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname COLLATE "C"`),
    triggers:
      await rows(`SELECT t.tgname AS name, ${unqualified('pg_get_triggerdef(t.oid)')} AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace=current_schema()::regnamespace AND NOT t.tgisinternal
      ORDER BY t.tgname COLLATE "C"`),
    functions:
      await rows(`SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
        md5(p.prosrc) AS body
      FROM pg_proc p WHERE p.pronamespace=current_schema()::regnamespace
      ORDER BY p.proname COLLATE "C", 2`),
    migrations: (await rows('SELECT version FROM arkvory_migrations ORDER BY version')).map(
      (row) => row.version,
    ),
  };
}

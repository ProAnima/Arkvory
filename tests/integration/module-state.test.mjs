import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate, PostgresModuleState } from '@proanima/arkvory-infrastructure';
import { moduleStateContract } from '@proanima/arkvory-extension-testkit';
import { MAX_MODULE_STATE_BYTES } from '@proanima/arkvory-extension-api';

async function fixture(t) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('ARKVORY_TEST_DATABASE_URL required');
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  const schema = 'arkvory_state_' + randomUUID().replaceAll('-', '');
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const isolated = new Pool({
    connectionString: url.toString(),
    max: 3,
    connectionTimeoutMillis: 5000,
  });
  t.after(async () => {
    await isolated.end();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });
  await migrate(isolated);
  await migrate(isolated);
  return {
    pool: isolated,
    first: new PostgresModuleState(isolated, 'module-a', false),
    second: new PostgresModuleState(isolated, 'module-a', false),
    reader: new PostgresModuleState(isolated, 'module-a', true),
    other: new PostgresModuleState(isolated, 'module-b', false),
  };
}

moduleStateContract('PostgreSQL module state', fixture);

test('module state validates bounds and survives a new adapter without numeric revision loss', async (t) => {
  const f = await fixture(t);
  for (const revision of ['0', '-1', '01', '1.1', '9223372036854775807'])
    await assert.rejects(f.first.compareExchange(revision, new Uint8Array()), {
      code: 'invalid_input',
    });
  await assert.rejects(f.first.compareExchange(null, new Uint8Array(MAX_MODULE_STATE_BYTES + 1)), {
    code: 'invalid_input',
  });
  assert.equal(await f.first.read(), null);
  await f.first.compareExchange(null, new Uint8Array([7]));
  await f.pool.query(
    "UPDATE arkvory_module_state SET revision=9007199254740993 WHERE module_id='module-a'",
  );
  const restarted = new PostgresModuleState(f.pool, 'module-a', false);
  assert.equal((await restarted.read()).revision, '9007199254740993');
  assert.deepEqual(await restarted.compareExchange('9007199254740993', new Uint8Array([8])), {
    kind: 'stored',
    revision: '9007199254740994',
  });
  assert.deepEqual([...(await f.reader.read()).value], [8]);
});

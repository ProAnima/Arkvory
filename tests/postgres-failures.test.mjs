import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '@proanima/depot-infrastructure';

test('a failed migration rollback destroys its connection instead of returning an open transaction to the pool', async () => {
  const failure = new Error('simulated transport failure');
  let destroyed;
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql === 'BEGIN') return {};
          throw failure;
        },
        release(value) {
          destroyed = value;
        },
      };
    },
  };
  await assert.rejects(migrate(pool), (error) => error === failure);
  assert.equal(destroyed, true);
});

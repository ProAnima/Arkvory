import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresContentPins, PostgresCleanup } from '@proanima/arkvory-infrastructure';
import { setup, create } from './fixture.mjs';

test('upload read pins exclude mutation and temporary cleanup, reference counted until release', async (t) => {
  const f = await setup(t);
  const id = (await create(f, Buffer.from('pending'))).json().id;
  const pins = new PostgresContentPins(f.catalog.sessions, 'upload');
  try {
    const cleanup = new PostgresCleanup(f.catalog.pool);
    const first = await pins.acquire(id);
    const second = await pins.acquire(id);
    const mutation = () => f.catalog.exclusive(id, async () => undefined);
    const collect = () => cleanup.exclusive(id, false, async () => undefined);
    await assert.rejects(mutation(), { code: 'busy' });
    await assert.rejects(collect(), { code: 'busy' });
    await first.release();
    await first.release();
    await assert.rejects(mutation(), { code: 'busy' });
    await second.release();
    await mutation();
    await collect();
    await assert.rejects(
      f.catalog.exclusive(id, async () => pins.acquire(id)),
      { code: 'busy' },
    );
  } finally {
    await pins.close();
  }
});

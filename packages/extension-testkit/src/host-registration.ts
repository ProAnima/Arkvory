import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type {
  ModuleStorageRegistry,
  ModuleStorageInstance,
  ComputePool,
  ChangeFeed,
} from '@proanima/arkvory-extension-api';

export function storageRegistrationContract(
  name: string,
  factory: (t: TestContext) => Promise<{
    registry: ModuleStorageRegistry;
    instance: ModuleStorageInstance;
    seal(): void;
  }>,
) {
  void test(`${name}: rejects duplicate, foreign and late registrations`, async (t) => {
    const h = await factory(t);
    assert.throws(() => {
      h.registry.add('../other', h.instance);
    });
    h.registry.add('store', h.instance);
    assert.throws(() => {
      h.registry.add('store', h.instance);
    });
    h.seal();
    assert.throws(() => {
      h.registry.add('late', h.instance);
    });
  });
}
export function computeContract(name: string, factory: (t: TestContext) => Promise<ComputePool>) {
  void test(`${name}: only declared tasks, copied values and cancellation`, async (t) => {
    const pool = await factory(t);
    const signal = new AbortController().signal;
    await assert.rejects(pool.run('not-declared', null, signal));
    assert.deepEqual(await pool.run('echo', { bytes: new Uint8Array([1, 2, 3]) }, signal), {
      bytes: new Uint8Array([1, 2, 3]),
    });
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(async () => pool.run('echo', null, cancelled.signal));
  });
}
export function changeFeedContract(name: string, factory: (t: TestContext) => Promise<ChangeFeed>) {
  void test(`${name}: bounded subscriptions and unique consumers`, async (t) => {
    const feed = await factory(t);
    const spec = {
      consumer: 'index',
      types: ['artifact.*'],
      batch: 1,
      handle: () => Promise.resolve(),
      resync: () => Promise.resolve(),
    };
    assert.throws(() => feed.subscribe({ ...spec, batch: 501 }));
    const subscription = feed.subscribe(spec);
    assert.throws(() => feed.subscribe(spec));
    await subscription.close();
    await subscription.close();
  });
}

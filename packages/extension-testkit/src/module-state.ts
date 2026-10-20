import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ModuleState } from '@proanima/arkvory-extension-api';

export interface ModuleStateHarness {
  readonly first: ModuleState;
  readonly second: ModuleState;
  readonly reader: ModuleState;
  readonly other: ModuleState;
}

/** Independent handles to the same namespace must serialize at storage, not in one process. */
export function moduleStateContract(
  name: string,
  setup: (t: TestContext) => Promise<ModuleStateHarness>,
): void {
  void test(`${name}: state CAS excludes stale writers and isolates module namespaces`, async (t) => {
    const f = await setup(t);
    assert.equal(await f.first.read(), null);
    const creation = await Promise.all([
      f.first.compareExchange(null, new Uint8Array([1])),
      f.second.compareExchange(null, new Uint8Array([2])),
    ]);
    assert.equal(creation.filter((r) => r.kind === 'stored' && r.revision === '1').length, 1);
    assert.equal(creation.filter((r) => r.kind === 'conflict').length, 1);
    assert.deepEqual(await f.second.compareExchange(null, new Uint8Array([2])), {
      kind: 'conflict',
    });
    const results = await Promise.all([
      f.first.compareExchange('1', new Uint8Array([3])),
      f.second.compareExchange('1', new Uint8Array([4])),
    ]);
    assert.equal(results.filter((r) => r.kind === 'stored').length, 1);
    assert.equal(results.filter((r) => r.kind === 'conflict').length, 1);
    const snapshot = await f.reader.read();
    assert.equal(snapshot?.revision, '2');
    assert.ok([3, 4].includes(snapshot.value[0] ?? 0));
    await assert.rejects(f.reader.compareExchange('2', new Uint8Array([5])), { code: 'read_only' });
    assert.equal(await f.other.read(), null);
    assert.deepEqual(await f.second.compareExchange('1', new Uint8Array([6])), {
      kind: 'conflict',
    });
  });
}

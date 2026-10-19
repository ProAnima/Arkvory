import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDerivedCacheGroup } from '@proanima/arkvory-extension-testkit';

const expected = { alpha: new Uint8Array([1, 2, 3, 4]) };
function reader() {
  return {
    async stat(name) {
      return name === 'alpha' ? { size: 4 } : null;
    },
    async list() {
      return { items: ['alpha'], next: null };
    },
    async *read(_name, range) {
      yield range ? expected.alpha.slice(range.start, range.end + 1) : expected.alpha;
    },
    async release() {},
  };
}

test('derived-cache contract oracle accepts exact public reads and rejects incomplete groups', async () => {
  await assertDerivedCacheGroup(reader(), expected);
  const defects = [
    {
      async stat() {
        return { size: 3 };
      },
    },
    {
      async list() {
        return { items: [], next: null };
      },
    },
    {
      async list() {
        return { items: ['manifest'], next: null };
      },
    },
    {
      async list() {
        return { items: ['alpha'], next: 'stuck' };
      },
    },
    {
      async *read() {
        yield new Uint8Array([1, 2, 9, 4]);
      },
    },
    {
      async *read(_name, range) {
        yield range ? expected.alpha.slice(1, 2) : expected.alpha;
      },
    },
  ];
  for (const defect of defects)
    await assert.rejects(assertDerivedCacheGroup({ ...reader(), ...defect }, expected), {
      code: 'ERR_ASSERTION',
    });
});

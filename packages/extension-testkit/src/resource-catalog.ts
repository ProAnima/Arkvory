import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceCatalog, ResourceFile } from '@proanima/arkvory-extension-api';

export interface ResourceCatalogHarness {
  readonly first: ResourceCatalog;
  readonly second: ResourceCatalog;
  readonly reader: ResourceCatalog;
  readonly other: ResourceCatalog;
  write(owner: string, file: ResourceFile): Promise<void>;
  closeOwner(owner: string): Promise<void>;
}

export function resourceCatalogContract(
  name: string,
  setup: (t: TestContext) => Promise<ResourceCatalogHarness>,
): void {
  void test(`${name}: durable resource publication, namespace isolation and owner fencing`, async (t) => {
    const f = await setup(t);
    const file: ResourceFile = {
      key: 'shared',
      name: 'resources/shared/one',
      metadata: new Uint8Array([1, 2]),
      sources: [],
    };
    assert.equal(await f.first.ready(), false);
    await f.first.initialize();
    await f.write('upload', file);
    assert.deepEqual(await f.second.find('shared'), file);
    assert.deepEqual(await f.reader.find('shared'), file);
    assert.equal(await f.other.find('shared'), null);
    await assert.rejects(f.reader.reserve('reader', file), { code: 'read_only' });
    await assert.rejects(f.reader.collect(0, 1), { code: 'read_only' });
    await f.second.retain('other-upload', ['shared']);
    await f.closeOwner('upload');
    assert.equal(await f.first.collect(0, 10), 0);
    await assert.rejects(f.second.publish('upload', file.name), { code: 'conflict' });
    await f.closeOwner('other-upload');
    assert.equal(await f.first.collect(0, 10), 1);
    await assert.rejects(f.first.retain('upload', ['shared']), { code: 'conflict' });
  });
}

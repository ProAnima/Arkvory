import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModuleRemoval,
  openModuleData as openCoordinatedData,
} from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

const options = { durable: false, exclusive: false };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-data-removal-'));
  t.after(() => removeTestDirectory(root));
  const removal = new ModuleRemoval();
  const opened = await openModuleData({
    dataDirectory: root,
    moduleId: 'test-store',
    quota: { bytes: 100, files: 10 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    requireRemoval: () => removal.require(),
  });
  return {
    root,
    ...opened.directory,
    admitted: (work) => removal.collect(() => undefined, work),
  };
}

async function write(area, name, value) {
  const sink = await area.create(name, options);
  await sink.write(Buffer.from(value));
  await sink.close();
}

async function text(area, name) {
  const chunks = [];
  for await (const chunk of area.read(name)) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('published data cannot be replaced or renamed without core removal admission', async (t) => {
  const f = await fixture(t);
  await write(f.data, 'original', 'old');
  await write(f.data, 'replacement', 'new');
  await assert.rejects(f.data.create('original', options), { code: 'busy' });
  await assert.rejects(f.data.rename('replacement', 'original'), { code: 'busy' });
  await assert.rejects(f.data.rename('original', 'moved'), { code: 'busy' });
  assert.equal(await text(f.data, 'original'), 'old');
  assert.equal(await text(f.data, 'replacement'), 'new');
  await f.admitted(() => f.data.rename('replacement', 'original'));
  assert.equal(await text(f.data, 'original'), 'new');
  await f.admitted(() => write(f.data, 'original', 'allowed'));
  assert.equal(await text(f.data, 'original'), 'allowed');
});

test('a sink does not retain removal admission from create until a later close', async (t) => {
  const f = await fixture(t);
  await write(f.data, 'original', 'old');
  const sink = await f.admitted(() => f.data.create('original', options));
  await sink.write(Buffer.from('replacement'));
  await assert.rejects(sink.close(), { code: 'busy' });
  assert.equal(await text(f.data, 'original'), 'old');
  assert.equal(f.data.usage().bytes, 3);
  // A refused publication must close its file and remove the staged replacement.
  const temporary = join(f.root, 'module-data', 'test-store', 'tmp', 'coordinated-v1');
  for (const session of await readdir(temporary))
    assert.deepEqual(await readdir(join(temporary, session)), []);
});

test('a target created after sink creation cannot be overwritten without admission', async (t) => {
  const f = await fixture(t);
  const delayed = await f.data.create('target', options);
  await delayed.write(Buffer.from('late'));
  await write(f.data, 'target', 'published');
  await assert.rejects(delayed.close(), { code: 'busy' });
  assert.equal(await text(f.data, 'target'), 'published');
  assert.equal(f.data.usage().bytes, 9);
  assert.equal(f.data.usage().files, 1);
});

test('cache replacement remains independent of published-data removal admission', async (t) => {
  const f = await fixture(t);
  await write(f.cache, 'entry', 'old');
  await write(f.cache, 'entry', 'new');
  await write(f.cache, 'other', 'next');
  await f.cache.rename('other', 'entry');
  assert.equal(await text(f.cache, 'entry'), 'next');
});

// Single-process contract fixture only. PostgreSQL ownership is covered by integration tests.
function openModuleData(options) {
  return openCoordinatedData({
    ...options,
    coordinator: {
      owner: randomUUID(),
      run: async (_module, work) =>
        work({
          check() {},
          orphan: async () => {},
        }),
    },
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectMount, initializeVolume } from '../apps/deploy/dist/storage-volume.js';
import { removeTestDirectory } from './helpers.mjs';

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-volume-init-'));
  t.after(() => removeTestDirectory(root));
  return root;
}

test('volume-init marks an empty directory once, with a synced identity file', async (t) => {
  const volume = join(await directory(t), 'volume-2');
  await assert.rejects(
    initializeVolume({ directory: volume, expectMount: false }),
    /does not exist/,
  );
  await mkdir(volume);
  await mkdir(join(volume, 'lost+found'));
  const identity = await initializeVolume({ directory: volume, expectMount: false });
  assert.match(identity, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await readFile(join(volume, 'storage-id'), 'utf8'), identity);
  // No temporary file is left, and a second run never replaces the identity.
  assert.deepEqual((await readdir(volume)).sort(), ['lost+found', 'storage-id']);
  await assert.rejects(
    initializeVolume({ directory: volume, expectMount: false }),
    /already initialized/,
  );
  assert.equal(await readFile(join(volume, 'storage-id'), 'utf8'), identity);
  await assert.rejects(initializeVolume({ directory: 'relative', expectMount: false }), /absolute/);
});

test('volume-init refuses a directory with content and an unmounted mount point', async (t) => {
  const parent = await directory(t);
  const used = join(parent, 'used');
  await mkdir(used);
  await writeFile(join(used, 'data.bin'), 'x');
  await assert.rejects(initializeVolume({ directory: used, expectMount: false }), /not empty/);
  // The empty directory of a volume that is not mounted is on the file system of its parent.
  const mountPoint = join(parent, 'mnt');
  await mkdir(mountPoint);
  const sameDevice = async () => 1n;
  await assert.rejects(
    initializeVolume({ directory: mountPoint, expectMount: true, device: sameDevice }),
    /not a mount point/,
  );
  assert.deepEqual(await readdir(mountPoint), [], 'nothing written beneath the mount point');
  // Mounted: the directory is the root of another file system.
  const mounted = async (path) => (path === mountPoint ? 2n : 1n);
  await initializeVolume({ directory: mountPoint, expectMount: true, device: mounted });
  assert.deepEqual(await readdir(mountPoint), ['storage-id']);
});

test('the mount check is on by default on Linux and can be chosen explicitly', () => {
  assert.equal(expectMount(new Map(), 'linux'), true);
  assert.equal(expectMount(new Map(), 'win32'), false);
  assert.equal(expectMount(new Map([['no-expect-mount', 'true']]), 'linux'), false);
  assert.equal(expectMount(new Map([['expect-mount', 'true']]), 'win32'), true);
  assert.throws(
    () =>
      expectMount(
        new Map([
          ['expect-mount', 'true'],
          ['no-expect-mount', 'true'],
        ]),
        'linux',
      ),
    /Choose one/,
  );
});

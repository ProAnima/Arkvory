import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, statfs, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDirectoryContract } from '../packages/extension-testkit/dist/index.js';
import {
  LocalBlobStore,
  openModuleData,
  requireVolumeRoom,
} from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

// The core's data directory of a module (ADR 0083, N6) and the inode reserve of its storage.
async function scratch(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

/** A volume with room, or one whose free inodes fall below the reserve once exhausted. */
function volume() {
  let exhausted = false;
  return {
    exhaust: () => {
      exhausted = true;
    },
    probe: async () => ({
      bavail: 1n << 40n,
      bsize: 1n,
      files: 1_000_000n,
      ffree: exhausted ? 10n : 900_000n,
    }),
  };
}

dataDirectoryContract('local module data', async (t, quota) => {
  const dataDirectory = await scratch(t, 'arkvory-module-data-');
  const { probe, exhaust } = volume();
  const options = {
    dataDirectory,
    moduleId: 'op-index',
    quota,
    reserve: { bytes: 0, inodes: 100 },
    probe,
  };
  const writer = await openModuleData({ ...options, readOnly: false });
  const gateway = await openModuleData({ ...options, readOnly: true });
  return {
    writer: writer.directory,
    gateway: gateway.directory,
    async plantLink(name) {
      const outside = await scratch(t, 'arkvory-outside-');
      await writeFile(join(outside, 'secret'), 'x');
      try {
        // A junction needs no privilege on Windows; elsewhere a directory link.
        await symlink(
          outside,
          join(dataDirectory, 'module-data', 'op-index', 'data', name),
          'junction',
        );
        return true;
      } catch {
        return false;
      }
    },
    exhaustInodes: exhaust,
  };
});

test('the accounting is reconciled with files written behind the port', async (t) => {
  const dataDirectory = await scratch(t, 'arkvory-module-data-');
  const options = {
    dataDirectory,
    moduleId: 'op-index',
    quota: { bytes: 1000, files: 10 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
  };
  const data = await openModuleData(options);
  const area = join(dataDirectory, 'module-data', 'op-index', 'data');
  await mkdir(join(area, 'x'), { recursive: true });
  await writeFile(join(area, 'x', 'behind'), Buffer.alloc(7));
  assert.equal(data.directory.data.usage().files, 0);
  await data.reconcile();
  assert.deepEqual(data.directory.data.usage(), {
    bytes: 7,
    files: 1,
    quotaBytes: 1000,
    quotaFiles: 10,
  });
  // A crash left a file being written: the next writer drops it and counts the rest.
  await writeFile(join(dataDirectory, 'module-data', 'op-index', 'tmp', 'left'), 'abc');
  const reopened = await openModuleData(options);
  assert.equal(reopened.directory.cache.usage().bytes, 7);
});

test('the volume check keeps a reserve of bytes and of inodes where inodes are counted', async () => {
  const at = (bavail, files, ffree) => async () => ({ bavail, bsize: 4096n, files, ffree });
  const reserve = { bytes: 4096, inodes: 100 };
  await requireVolumeRoom('x', 4096, reserve, at(2n, 1000n, 100n));
  const full = { code: 'capacity_exceeded', reason: 'storage_full' };
  await assert.rejects(requireVolumeRoom('x', 4097, reserve, at(2n, 1000n, 100n)), full);
  await assert.rejects(requireVolumeRoom('x', 0, reserve, at(2n, 1000n, 99n)), full);
  // NTFS and some network file systems count no inodes: only bytes are checked there.
  await requireVolumeRoom('x', 0, reserve, at(2n, 0n, 0n));
});

test('a storage refuses writes when the volume runs short of inodes', async (t) => {
  const root = await scratch(t, 'arkvory-inodes-');
  const free = (await statfs(root, { bigint: true })).ffree;
  // The reserve applies only where the file system counts inodes (not on NTFS).
  const store = new LocalBlobStore(root, 0, undefined, undefined, Number(free) + 1_000_000);
  await store.initialize();
  if (free === 0n) {
    await store.checkSpace(1);
    return;
  }
  await assert.rejects(store.checkSpace(1), { code: 'capacity_exceeded', reason: 'storage_full' });
  await new LocalBlobStore(root, 0, undefined, undefined, 0).checkSpace(1);
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ModuleDataDirectory, ModuleFiles } from '@proanima/arkvory-extension-api';
import { bytesOf, gather, hasCode } from './support.js';

/** One module's directory under test. */
export interface DataDirectoryHarness {
  /** The module's directory in a process that writes. */
  readonly writer: ModuleDataDirectory;
  /** The same files as a read gateway sees them. */
  readonly gateway: ModuleDataDirectory;
  /**
   * Puts a symbolic link `name` into the data area behind the port, pointing outside it; false
   * when the platform cannot make one here.
   */
  plantLink(name: string): Promise<boolean>;
  /** Makes the volume report fewer free inodes than the core's reserve. */
  exhaustInodes(): void;
}

export interface DataQuota {
  readonly bytes: number;
  readonly files: number;
}

async function write(files: ModuleFiles, name: string, bytes: Uint8Array, exclusive = false) {
  const sink = await files.create(name, { durable: true, exclusive });
  await sink.write(bytes);
  await sink.close();
}

const refusedWith = (code: string) => (error: unknown) => hasCode(error, code);

async function atomicFiles(
  open: (quota: DataQuota) => Promise<DataDirectoryHarness>,
): Promise<void> {
  const { writer } = await open({ bytes: 1 << 20, files: 100 });
  const data = writer.data;
  const sink = await data.create('index/segment-1', { durable: true, exclusive: true });
  await sink.write(bytesOf('a', 10));
  assert.equal(await data.stat('index/segment-1'), null, 'invisible before close');
  await sink.close();
  assert.deepEqual(await data.stat('index/segment-1'), { size: 10 });
  assert.deepEqual(
    await gather(data.read('index/segment-1', { start: 2, end: 4 })),
    bytesOf('a', 10).subarray(2, 5),
  );
  await assert.rejects(
    write(data, 'index/segment-1', bytesOf('b', 3), true),
    refusedWith('conflict'),
  );
  await write(data, 'index/segment-1', bytesOf('c', 4));
  assert.deepEqual(await data.stat('index/segment-1'), { size: 4 });
  await write(data, 'index/segment-2', bytesOf('d', 1));
  await write(data, 'other', bytesOf('e', 1));
  assert.deepEqual(await data.list('index/', null, 1), {
    items: ['index/segment-1'],
    next: 'index/segment-1',
  });
  assert.deepEqual(await data.list('index/', 'index/segment-1', 10), {
    items: ['index/segment-2'],
    next: null,
  });
  await data.rename('index/segment-2', 'index/segment-3');
  assert.equal(await data.stat('index/segment-2'), null);
  await data.remove('index/segment-3');
  await data.remove('index/segment-3');
  const aborted = await data.create('partial', { durable: false, exclusive: false });
  await aborted.write(bytesOf('f', 5));
  await aborted.abort();
  await aborted.abort();
  assert.equal(await data.stat('partial'), null);
  await assert.rejects(gather(data.read('partial')), refusedWith('unavailable'));
  // The cache area is separate from the data area.
  await write(writer.cache, 'other', bytesOf('g', 2));
  assert.deepEqual(await data.stat('other'), { size: 1 });
}

async function confinedNames(
  open: (quota: DataQuota) => Promise<DataDirectoryHarness>,
): Promise<void> {
  const harness = await open({ bytes: 1 << 20, files: 100 });
  const data = harness.writer.data;
  for (const bad of ['../escape', '/absolute', 'a/../b', 'a\\b', '', 'a//b', 'C:/x', 'a/./b'])
    await assert.rejects(
      data.create(bad, { durable: false, exclusive: false }),
      refusedWith('invalid_input'),
      bad,
    );
  if (await harness.plantLink('link')) {
    await assert.rejects(gather(data.read('link')), refusedWith('invalid_input'));
    await assert.rejects(
      data.create('link/inner', { durable: false, exclusive: false }),
      refusedWith('invalid_input'),
    );
  }
}

async function quotas(open: (quota: DataQuota) => Promise<DataDirectoryHarness>): Promise<void> {
  const { writer } = await open({ bytes: 1000, files: 2 });
  await write(writer.data, 'a', bytesOf('a', 600));
  const sink = await writer.cache.create('b', { durable: false, exclusive: false });
  await assert.rejects(sink.write(bytesOf('b', 500)), refusedWith('module_quota_exceeded'));
  await sink.abort();
  assert.equal(await writer.cache.stat('b'), null);
  assert.deepEqual(writer.data.usage(), {
    bytes: 600,
    files: 1,
    quotaBytes: 1000,
    quotaFiles: 2,
  });
  await write(writer.cache, 'c', bytesOf('c', 10));
  // Both areas count against one quota of files.
  await assert.rejects(
    write(writer.data, 'd', bytesOf('d', 1)),
    refusedWith('module_quota_exceeded'),
  );
  // Replacing a file frees the old bytes.
  await write(writer.data, 'a', bytesOf('e', 900));
  assert.deepEqual(writer.cache.usage(), {
    bytes: 910,
    files: 2,
    quotaBytes: 1000,
    quotaFiles: 2,
  });
  await writer.data.remove('a');
  assert.deepEqual(writer.data.usage(), { bytes: 10, files: 1, quotaBytes: 1000, quotaFiles: 2 });
}

async function inodeReserve(
  open: (quota: DataQuota) => Promise<DataDirectoryHarness>,
): Promise<void> {
  const harness = await open({ bytes: 1 << 20, files: 100 });
  harness.exhaustInodes();
  await assert.rejects(
    write(harness.writer.data, 'a', bytesOf('a', 1)),
    refusedWith('capacity_exceeded'),
  );
  assert.equal(harness.writer.data.usage().files, 0);
}

async function readOnlyGateway(
  open: (quota: DataQuota) => Promise<DataDirectoryHarness>,
): Promise<void> {
  const { writer, gateway } = await open({ bytes: 1 << 20, files: 100 });
  await write(writer.data, 'shared', bytesOf('s', 3));
  assert.deepEqual(await gather(gateway.data.read('shared')), bytesOf('s', 3));
  await assert.rejects(
    gateway.data.create('x', { durable: false, exclusive: false }),
    refusedWith('read_only'),
  );
  await assert.rejects(gateway.data.rename('shared', 'x'), refusedWith('read_only'));
  await assert.rejects(gateway.data.remove('shared'), refusedWith('read_only'));
  assert.deepEqual(await gateway.data.stat('shared'), { size: 3 });
}

const CASES: readonly (readonly [
  string,
  (open: (quota: DataQuota) => Promise<DataDirectoryHarness>) => Promise<void>,
])[] = [
  ['files are created atomically, listed, renamed and removed', atomicFiles],
  ['names outside the area, with backslashes or through links are refused', confinedNames],
  ['byte and file quotas refuse a write at once and keep the usage exact', quotas],
  ["the core's inode reserve refuses new files", inodeReserve],
  ['a read gateway reads the same files and refuses every change', readOnlyGateway],
];

/**
 * The `data-directory` contract (ADR 0083, N6): names stay inside the area, writes are counted
 * against byte and file quotas at once, the core's reserves hold, a gateway only reads.
 */
export function dataDirectoryContract(
  name: string,
  open: (t: TestContext, quota: DataQuota) => Promise<DataDirectoryHarness>,
): void {
  for (const [title, run] of CASES)
    void test(`${name}: ${title}`, (t) => run((quota) => open(t, quota)));
}

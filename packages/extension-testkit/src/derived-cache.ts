import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { CacheBuild, CacheRead, DerivedCache } from '@proanima/arkvory-extension-api';
import { gather } from './support.js';

export interface DerivedCacheHarness {
  readonly writer: DerivedCache;
  /** Independent adapter over the same module namespace and quota. */
  readonly peer: DerivedCache;
  readonly gateway: DerivedCache;
}

export interface DerivedCacheQuota {
  readonly bytes: number;
  readonly files: number;
}

type Factory = (t: TestContext, quota: DerivedCacheQuota) => Promise<DerivedCacheHarness>;
const quota = { bytes: 65536, files: 32 };
const reserve = { bytes: 8192, files: 8 };
const signal = () => new AbortController().signal;
const content = (tag: number) => ({
  alpha: new Uint8Array([tag, 2, 3, 4]),
  'pages/one': new Uint8Array([5, tag, 7]),
});

/** Exact public-port oracle, also exercised against deliberately defective readers by unit tests. */
export async function assertDerivedCacheGroup(
  reader: CacheRead,
  expected: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  const names = Object.keys(expected).sort();
  const listed: string[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page <= names.length; page++) {
    const result = await reader.list(cursor, 1);
    assert.ok(result.items.length <= 1, 'page limit');
    listed.push(...result.items);
    cursor = result.next;
    if (cursor === null) break;
    assert.equal(seen.has(cursor), false, 'cursor must make progress');
    seen.add(cursor);
  }
  assert.equal(cursor, null, 'listing must terminate');
  assert.deepEqual(listed, names, 'only module files, exactly once; no manifest');
  for (const [name, bytes] of Object.entries(expected)) {
    assert.deepEqual(await reader.stat(name), { size: bytes.length });
    assert.deepEqual(await gather(reader.read(name)), bytes, `exact bytes: ${name}`);
    if (bytes.length >= 3)
      assert.deepEqual(
        await gather(reader.read(name, { start: 1, end: 2 })),
        bytes.slice(1, 3),
        'inclusive range',
      );
  }
  assert.equal(await reader.stat('absent'), null);
}

async function write(build: CacheBuild, values: Readonly<Record<string, Uint8Array>>) {
  for (const [name, bytes] of Object.entries(values)) {
    const sink = await build.create(name);
    await sink.write(bytes);
    await sink.close();
  }
}

async function publication(h: DerivedCacheHarness) {
  assert.equal(await h.peer.open('group', signal()), null);
  const build = await h.writer.begin('group', reserve, signal());
  assert.ok(build);
  const sink = await build.create('alpha');
  await sink.write(content(1).alpha);
  await assert.rejects(build.commit(signal()), { code: 'conflict' });
  assert.equal(await h.peer.open('group', signal()), null);
  await sink.close();
  await assert.rejects(build.create('alpha'), { code: 'conflict' });
  await write(build, { 'pages/one': content(1)['pages/one'] });
  assert.equal(await h.peer.open('group', signal()), null, 'closed sinks are not publication');
  await build.commit(signal());
  await build.commit(signal());
  await build.abort();
  const old = await h.peer.open('group', signal());
  assert.ok(old);
  try {
    await assertDerivedCacheGroup(old, content(1));
    const replacement = await h.writer.begin('group', reserve, signal());
    assert.ok(replacement);
    await write(replacement, content(9));
    await replacement.commit(signal());
    await assertDerivedCacheGroup(old, content(1));
    const current = await h.gateway.open('group', signal());
    assert.ok(current);
    try {
      await assertDerivedCacheGroup(current, content(9));
    } finally {
      await current.release();
    }
  } finally {
    await old.release();
  }
  await old.release();
  await assert.rejects(async () => old.stat('alpha'));
  await assert.rejects(async () => old.list(null, 1));
  await assert.rejects(gather(old.read('alpha')));
}

async function lifecycle(h: DerivedCacheHarness) {
  await assert.rejects(async () => h.gateway.begin('denied', reserve, signal()), {
    code: 'read_only',
  });
  const abandoned = await h.writer.begin('abandoned', reserve, signal());
  assert.ok(abandoned);
  const partial = await abandoned.create('partial');
  await partial.write(new Uint8Array([1, 2, 3]));
  await abandoned.abort();
  await abandoned.abort();
  assert.equal(await h.peer.open('abandoned', signal()), null);
  await assert.rejects(partial.write(new Uint8Array([4])));
  await assert.rejects(abandoned.commit(signal()));
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(async () => h.writer.begin('cancelled', reserve, cancelled.signal));
  await assert.rejects(async () => h.peer.open('cancelled', cancelled.signal));
  const build = await h.writer.begin('read-cancel', reserve, signal());
  assert.ok(build);
  await write(build, content(3));
  await build.commit(signal());
  const reading = new AbortController();
  const reader = await h.peer.open('read-cancel', reading.signal);
  assert.ok(reader);
  const stream = reader.read('alpha')[Symbol.asyncIterator]();
  try {
    assert.equal((await stream.next()).done, false);
    reading.abort();
    await reader.release();
    await assert.rejects(async () => reader.stat('alpha'));
    await assert.rejects(gather(reader.read('alpha')));
  } finally {
    await stream.return?.();
    await reader.release();
  }
}

async function limits(h: DerivedCacheHarness) {
  for (const key of ['', 'x'.repeat(257)])
    await assert.rejects(async () => h.writer.begin(key, reserve, signal()), {
      code: 'invalid_input',
    });
  for (const budget of [
    { bytes: -1, files: 8 },
    { bytes: 8192, files: 4097 },
  ])
    await assert.rejects(async () => h.writer.begin('bad', budget, signal()), {
      code: 'invalid_input',
    });
  const build = await h.writer.begin('quota', quota, signal());
  assert.ok(build);
  assert.equal(await h.peer.begin('quota', reserve, signal()), null, 'one builder per key');
  assert.equal(await h.peer.begin('other', reserve, signal()), null, 'full reservation is shared');
  for (const name of ['../escape', '/absolute', 'a/../b', ''])
    await assert.rejects(build.create(name), { code: 'invalid_input' });
  const sink = await build.create('large');
  await assert.rejects(sink.write(new Uint8Array(quota.bytes + 1)), {
    code: 'module_quota_exceeded',
  });
  await build.abort();
  assert.equal(await h.peer.open('quota', signal()), null);
  const valid = await h.writer.begin('ranges', reserve, signal());
  assert.ok(valid);
  await write(valid, content(7));
  await valid.commit(signal());
  const reader = await h.peer.open('ranges', signal());
  assert.ok(reader);
  try {
    for (const limit of [0, 1001])
      await assert.rejects(reader.list(null, limit), { code: 'invalid_input' });
    for (const range of [
      { start: -1, end: 1 },
      { start: 1, end: 4 },
      { start: 2, end: 1 },
    ])
      await assert.rejects(gather(reader.read('alpha', range)), { code: 'invalid_input' });
    await assert.rejects(gather(reader.read('absent')), { code: 'unavailable' });
  } finally {
    await reader.release();
  }
}

/** Each factory call supplies fresh real adapters and registers their cleanup with t.after. */
export function derivedCacheContract(name: string, open: Factory): void {
  for (const [label, check] of [
    ['atomic publication, pinned replacement and exact reads', publication],
    ['read-only, abort, cancellation and released handles', lifecycle],
    ['shared reservation, confined names and bounded ranges/pages', limits],
  ] as const)
    void test(`${name}: ${label}`, async (t) => check(await open(t, quota)));
}

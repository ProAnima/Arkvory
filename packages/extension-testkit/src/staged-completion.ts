import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type {
  BlobDescriptor,
  PartRef,
  StagedCompletion,
  StagedObject,
} from '@proanima/arkvory-extension-api';
import {
  abortedSignal,
  bytesOf,
  descriptorOf,
  gather,
  hasCode,
  neverAborted,
  sha256,
} from './support.js';

/** A storage under test with the hooks the suite needs around its `StagedCompletion`. */
export interface StagedHarness {
  readonly completion: StagedCompletion;
  /** Stores an accepted part the way the storage keeps parts the core uploaded. */
  putPart(id: string, part: PartRef, bytes: Uint8Array): Promise<void>;
  /** Changes one byte of an accepted part behind the storage's back. */
  corruptPart(id: string, part: PartRef): Promise<void>;
  /** The bytes the storage serves for a published object, or null when it is not visible. */
  published(id: string, size: number): Promise<Uint8Array | null>;
  /** Another handle on the same data, as after a restart of the process. */
  reopen(): StagedCompletion;
  /** A handle on the same data in `read-only` mode. */
  readOnly(): StagedCompletion;
}

/**
 * How the core completes from stored parts (ADR 0083, N1): it reads every byte itself, compares
 * size and SHA-256, discards on a mismatch and commits otherwise. The suite drives the storage
 * the same way, so a storage that passes behaves under the core as it does here.
 */
export async function verifyThenCommit(
  object: StagedObject,
  expected: BlobDescriptor,
): Promise<boolean> {
  const bytes = await gather(object.read());
  if (bytes.byteLength !== expected.size || sha256(bytes) !== expected.sha256) {
    await object.discard();
    return false;
  }
  await object.commit(expected, neverAborted);
  return true;
}

/** Three parts of an object: two full parts and a short last one. */
async function stored(harness: StagedHarness, partBytes = 1024) {
  const id = randomUUID();
  const whole = bytesOf(id, partBytes * 2 + 100);
  const parts: PartRef[] = [];
  for (let index = 0, offset = 0; offset < whole.byteLength; index++, offset += partBytes) {
    const bytes = whole.subarray(offset, Math.min(offset + partBytes, whole.byteLength));
    const part = { index, size: bytes.byteLength, sha256: sha256(bytes) };
    await harness.putPart(id, part, bytes);
    parts.push(part);
  }
  return { id, whole, parts, expected: descriptorOf(whole) };
}

/**
 * The `staged-completion` contract (ADR 0083, N1; ADR 0079, section 7): every storage that offers
 * completion from accepted parts passes it. `open(t)` returns a fresh, empty storage.
 */
export function stagedCompletionContract(
  name: string,
  open: (t: TestContext) => Promise<StagedHarness>,
): void {
  void test(`${name}: compose gives the parts in order, exact ranges, nothing visible before commit`, async (t) => {
    const harness = await open(t);
    const { id, whole, parts, expected } = await stored(harness);
    const object = await harness.completion.compose(id, parts, neverAborted);
    assert.equal(object.size, whole.byteLength);
    assert.deepEqual(await gather(object.read()), whole);
    for (const [start, end] of [
      [0, 0],
      [1000, 1100],
      [whole.byteLength - 1, whole.byteLength - 1],
    ] as const)
      assert.deepEqual(await gather(object.read({ start, end })), whole.subarray(start, end + 1));
    assert.equal(await harness.published(id, whole.byteLength), null, 'invisible before commit');
    assert.equal(await verifyThenCommit(object, expected), true);
    assert.deepEqual(await harness.published(id, whole.byteLength), whole);
    // Repeating the commit after success succeeds.
    await object.commit(expected, neverAborted);
  });

  void test(`${name}: a crash between commit and publication is retried by composing again`, async (t) => {
    const harness = await open(t);
    const { id, whole, parts, expected } = await stored(harness);
    assert.equal(
      await verifyThenCommit(await harness.completion.compose(id, parts, neverAborted), expected),
      true,
    );
    // Another process after a restart: the committed object is returned and checked again.
    const again = await harness.reopen().compose(id, parts, neverAborted);
    assert.deepEqual(await gather(again.read()), whole);
    assert.equal(await verifyThenCommit(again, expected), true);
    assert.deepEqual(await harness.published(id, whole.byteLength), whole);
  });

  void test(`${name}: compose is idempotent and discard drops the object, never the parts`, async (t) => {
    const harness = await open(t);
    const { id, whole, parts, expected } = await stored(harness);
    const first = await harness.completion.compose(id, parts, neverAborted);
    const second = await harness.completion.compose(id, parts, neverAborted);
    assert.deepEqual(await gather(second.read()), whole);
    await first.discard();
    await first.discard();
    assert.equal(await harness.published(id, whole.byteLength), null);
    const third = await harness.reopen().compose(id, parts, neverAborted);
    assert.equal(await verifyThenCommit(third, expected), true);
  });

  void test(`${name}: a part changed after compose is caught by the reading core, never published`, async (t) => {
    const harness = await open(t);
    const { id, whole, parts, expected } = await stored(harness);
    const object = await harness.completion.compose(id, parts, neverAborted);
    const changed = parts[1];
    assert.ok(changed);
    await harness.corruptPart(id, changed);
    const read = await gather(object.read());
    if (sha256(read) === expected.sha256) {
      // The storage snapshotted the parts at compose: what it commits is what was read.
      assert.equal(await verifyThenCommit(object, expected), true);
      assert.deepEqual(await harness.published(id, whole.byteLength), whole);
      return;
    }
    assert.equal(await verifyThenCommit(object, expected), false);
    assert.equal(await harness.published(id, whole.byteLength), null);
  });

  void test(`${name}: a read-only storage refuses compose with read_only; cancellation is honoured`, async (t) => {
    const harness = await open(t);
    const { id, parts } = await stored(harness);
    await assert.rejects(harness.readOnly().compose(id, parts, neverAborted), (error) =>
      hasCode(error, 'read_only'),
    );
    await assert.rejects(harness.completion.compose(id, parts, abortedSignal()));
    // A missing part is not composed into an object.
    const lost = { index: parts.length, size: 1, sha256: '0'.repeat(64) };
    await assert.rejects(harness.completion.compose(id, [...parts, lost], neverAborted));
  });
}

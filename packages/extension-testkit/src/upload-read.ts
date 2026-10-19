import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import type { AccessScope, UploadRead } from '@proanima/arkvory-extension-api';
import { gather } from './support.js';

export interface UploadReadHarness {
  readonly reader: UploadRead;
  readonly owner: AccessScope;
  readonly stranger: AccessScope;
  readonly ref: { repository: string; id: string };
  /** Accepted bytes at [0, bytes.length); at least three bytes. */
  readonly bytes: Uint8Array;
  revoke(): void;
  pins(): number;
}

/** Run against the actual service adapter, with storage/pin fixtures supplied by the host. */
export function uploadReadContract(name: string, open: () => Promise<UploadReadHarness>): void {
  void test(`${name}: ownership, exact range, invalid range and abort cleanup`, async () => {
    const h = await open();
    const signal = new AbortController().signal;
    assert.equal((await h.reader.upload(h.owner, h.ref.repository, h.ref.id))?.state, 'pending');
    assert.equal(await h.reader.upload(h.stranger, h.ref.repository, h.ref.id), null);
    assert.equal(
      (await gather(h.reader.read(h.stranger, h.ref, { start: 0, end: 1 }, signal))).length,
      0,
    );
    assert.deepEqual(
      await gather(h.reader.read(h.owner, h.ref, { start: 1, end: 2 }, signal)),
      h.bytes.slice(1, 3),
    );
    assert.equal(h.pins(), 0);
    await assert.rejects(gather(h.reader.read(h.owner, h.ref, { start: -1, end: 2 }, signal)), {
      code: 'invalid_input',
    });
    const cancel = new AbortController();
    const source = h.reader.read(
      h.owner,
      h.ref,
      { start: 0, end: h.bytes.length - 1 },
      cancel.signal,
    );
    const stream = source[Symbol.asyncIterator]();
    assert.equal((await stream.next()).done, false);
    assert.equal(h.pins(), 1);
    cancel.abort();
    await setImmediate();
    assert.equal(h.pins(), 0, 'abort closes a suspended iterator without consumer return');
    await stream.return?.();
    await assert.rejects(stream.next(), { code: 'unavailable' });
  });
  void test(`${name}: request revocation closes suspended reads and hides metadata`, async () => {
    const h = await open();
    const source = h.reader.read(
      h.owner,
      h.ref,
      { start: 0, end: 2 },
      new AbortController().signal,
    );
    const stream = source[Symbol.asyncIterator]();
    await stream.next();
    h.revoke();
    await setImmediate();
    assert.equal(h.pins(), 0, 'revocation closes a suspended iterator without consumer return');
    await stream.return?.();
    assert.equal(await h.reader.upload(h.owner, h.ref.repository, h.ref.id), null);
    await assert.rejects(stream.next(), { code: 'unavailable' });
  });
}

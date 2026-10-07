import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { VaultCipher, encryptedSize } from '@proanima/arkvory-infrastructure';

const MIB = 1024 * 1024;
const HEADER = 44;
const TAG = 16;
const vaultId = randomUUID();
const master = randomBytes(32);
const cipher = new VaultCipher(master, vaultId);
const blob = () => cipher.forFile('blob', 'content-id-1');

async function* pieces(data, size) {
  for (let offset = 0; offset < data.length; offset += size)
    yield data.subarray(offset, Math.min(data.length, offset + size));
}
async function collect(iterable) {
  const parts = [];
  for await (const part of iterable) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}
const seal = (file, data, size = 64 * 1024) => collect(file.encrypt(pieces(data, size)));
const open = (file, data, size = 64 * 1024) => collect(file.decrypt(pieces(data, size)));
const rejectsAuth = (promise) => assert.rejects(promise, { code: 'integrity_mismatch' });

test('content of every size round-trips and the file size follows from the content size', async () => {
  for (const size of [0, 1, 15, 16, MIB - 1, MIB, MIB + 1, 2 * MIB, 3 * MIB + 17]) {
    const data = randomBytes(size);
    const sealed = await seal(blob(), data);
    assert.equal(sealed.length, encryptedSize(size), `size ${size}`);
    assert.equal(sealed.length, HEADER + size + TAG * Math.max(1, Math.ceil(size / MIB)));
    assert.deepEqual(await open(blob(), sealed), data, `size ${size}`);
  }
});

test('the framing does not depend on how the input or the output is cut into pieces', async () => {
  const data = randomBytes(MIB + 12345);
  const sealed = await seal(blob(), data, 4096);
  assert.equal(sealed.length, encryptedSize(data.length));
  for (const size of [4096, 65536, MIB, 5 * MIB])
    assert.deepEqual(await open(blob(), sealed, size), data, `output pieces of ${size}`);
});

test('tiny pieces of input and output are handled in linear time', async () => {
  const data = randomBytes(2000);
  const sealed = await seal(blob(), data, 1);
  assert.deepEqual(await open(blob(), sealed, 1), data);
  const large = randomBytes(2 * MIB);
  const started = Date.now();
  assert.deepEqual(await open(blob(), await seal(blob(), large), 100), large);
  assert.ok(Date.now() - started < 20_000);
});

test('the ciphertext hides the content and differs on every encryption', async () => {
  const data = Buffer.alloc(2048, 'secret catalog row ');
  const first = await seal(blob(), data);
  const second = await seal(blob(), data);
  assert.notDeepEqual(first, second, 'a fresh salt makes a fresh key');
  assert.equal(first.includes(Buffer.from('secret catalog')), false);
  assert.equal(first.subarray(0, 8).toString(), 'ARKVGCM1');
  // Both are still the same content.
  assert.deepEqual(await open(blob(), second), data);
});

test('any changed byte is refused: header, content, tag, in the first and in the last chunk', async () => {
  const data = randomBytes(2 * MIB + 100);
  const sealed = await seal(blob(), data);
  const at = [
    0,
    8,
    9,
    12,
    20,
    HEADER,
    HEADER + 5,
    HEADER + MIB,
    sealed.length - TAG - 1,
    sealed.length - 1,
  ];
  for (const offset of at) {
    const damaged = Buffer.from(sealed);
    damaged[offset] ^= 1;
    await rejectsAuth(open(blob(), damaged));
  }
});

test('a cut or extended file is refused, including a cut at a chunk boundary', async () => {
  const data = randomBytes(2 * MIB + 100);
  const sealed = await seal(blob(), data);
  const frame = MIB + TAG;
  const cuts = [
    0,
    10,
    HEADER - 1,
    HEADER,
    HEADER + 100,
    HEADER + frame,
    HEADER + 2 * frame,
    sealed.length - 1,
  ];
  for (const length of cuts) await rejectsAuth(open(blob(), sealed.subarray(0, length)));
  await rejectsAuth(open(blob(), Buffer.concat([sealed, Buffer.from([0])])));
  await rejectsAuth(open(blob(), Buffer.concat([sealed, randomBytes(20)])));
  await rejectsAuth(open(blob(), Buffer.concat([sealed, sealed.subarray(HEADER, HEADER + frame)])));
  // A file that is exactly one full chunk and ends there is fine; one more chunk of nothing is not.
  const exact = await seal(blob(), randomBytes(MIB));
  assert.equal((await open(blob(), exact)).length, MIB);
});

test('chunks cannot be reordered, repeated or dropped', async () => {
  const data = randomBytes(3 * MIB);
  const sealed = await seal(blob(), data);
  const frame = MIB + TAG;
  const chunk = (n) => sealed.subarray(HEADER + n * frame, HEADER + (n + 1) * frame);
  const header = sealed.subarray(0, HEADER);
  await rejectsAuth(open(blob(), Buffer.concat([header, chunk(1), chunk(0), chunk(2)])));
  await rejectsAuth(open(blob(), Buffer.concat([header, chunk(0), chunk(0), chunk(2)])));
  await rejectsAuth(open(blob(), Buffer.concat([header, chunk(0), chunk(2)])));
  await rejectsAuth(open(blob(), Buffer.concat([header, chunk(0), chunk(1)])));
});

test('a file opens only under its own vault, kind and name, and with its own master key', async () => {
  const data = randomBytes(5000);
  const sealed = await seal(blob(), data);
  const wrong = [
    cipher.forFile('blob', 'content-id-2'),
    cipher.forFile('table', 'content-id-1'),
    cipher.forFile('scratch', 'content-id-1'),
    new VaultCipher(master, randomUUID()).forFile('blob', 'content-id-1'),
    new VaultCipher(randomBytes(32), vaultId).forFile('blob', 'content-id-1'),
  ];
  for (const file of wrong) await rejectsAuth(open(file, sealed));
  assert.deepEqual(await open(blob(), sealed), data);
});

test('a small document is read at once with the same checks', async () => {
  const file = cipher.forFile('manifest', 'point/manifest.json');
  const text = Buffer.from('{"pointId":"x"}\n');
  const sealed = await seal(file, text);
  assert.deepEqual(file.decryptBuffer(sealed), text);
  const big = await seal(file, randomBytes(2 * MIB + 5));
  assert.equal(file.decryptBuffer(big).length, 2 * MIB + 5);
  assert.throws(() => file.decryptBuffer(sealed.subarray(0, sealed.length - 1)), {
    code: 'integrity_mismatch',
  });
  assert.throws(() => file.decryptBuffer(Buffer.alloc(10)), { code: 'integrity_mismatch' });
  const damaged = Buffer.from(sealed);
  damaged[HEADER] ^= 1;
  assert.throws(() => file.decryptBuffer(damaged), { code: 'integrity_mismatch' });
  assert.throws(() => cipher.forFile('blob', 'x').decryptBuffer(sealed), {
    code: 'integrity_mismatch',
  });
});

test('a master key of the wrong size is refused', () => {
  assert.throws(() => new VaultCipher(randomBytes(16), vaultId), { code: 'unexpected' });
});

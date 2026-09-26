import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { parseDescriptor } from '@proanima/arkvory-domain';

async function clientFor(t, payload) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(payload);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return new ArkvoryClient(`http://127.0.0.1:${server.address().port}`, () => 'test-key');
}

function artifact(value, fields = 32) {
  const descriptor = {
    name: 'build.upack',
    size: '0',
    sha256: 'a'.repeat(64),
    labels: [],
    metadata: Object.fromEntries(
      Array.from({ length: fields }, (_, index) => [`field${index}`, value]),
    ),
  };
  parseDescriptor(descriptor);
  return {
    id: randomUUID(),
    repository: 'releases',
    status: 'available',
    createdAt: '2026-09-26T00:00:00.000Z',
    expiresAt: '2026-09-27T00:00:00.000Z',
    descriptor,
  };
}

for (const [name, value, fields] of [
  ['UTF-8 metadata', 'я'.repeat(1000), 31],
  ['JSON-escaped metadata', '\u0001'.repeat(300), 32],
]) {
  test(`artifact list accepts a native page with ${name} above the generic JSON bound`, async (t) => {
    const entry = artifact(value, fields);
    assert(Buffer.byteLength(JSON.stringify(entry.descriptor)) < 64 * 1024);
    const payload = JSON.stringify({ items: Array.from({ length: 50 }, () => entry), next: null });
    assert(Buffer.byteLength(payload) > 2 * 1024 ** 2);
    const client = await clientFor(t, payload);
    const page = await client.inRepository('releases').artifacts.list();
    assert.equal(page.items.length, 50);
    assert.deepEqual(page.items[49].descriptor.metadata, entry.descriptor.metadata);
  });
}

test('artifact list bound covers all 100 domain-valid descriptors with maximum escaping', async (t) => {
  const entry = artifact('\u0001'.repeat(1024));
  const payload = JSON.stringify({ items: Array.from({ length: 100 }, () => entry), next: null });
  assert(Buffer.byteLength(payload) > 8 * 1024 ** 2);
  const client = await clientFor(t, payload);
  const page = await client.list('releases');
  assert.equal(page.items.length, 100);
  assert.deepEqual(page.items[99].descriptor.metadata, entry.descriptor.metadata);
});

test('artifact list and generic JSON responses retain separate finite byte limits', async (t) => {
  const client = await clientFor(t, ' '.repeat(24 * 1024 ** 2 + 1));
  await assert.rejects(client.list('releases'), /Response exceeds SDK limit/);
  const generic = await clientFor(t, ' '.repeat(2 * 1024 ** 2 + 1));
  await assert.rejects(generic.artifact('releases', randomUUID()), /Response exceeds SDK limit/);
});

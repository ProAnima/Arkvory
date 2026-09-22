import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DepotClient } from '@proanima/depot-sdk';
import { setup, descriptor, base } from './fixture.mjs';

test('portable SDK uploads parts, edits annotations and streams HTTP ranges', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  const client = new DepotClient(address, () => f.headers.authorization.slice(7));
  const bytes = Buffer.from('sdk test data');
  const upload = await client.create('releases', randomUUID(), descriptor(bytes));
  assert.equal((await client.resume('releases', upload.id, new Blob([bytes]))).status, 'available');
  assert.equal((await client.annotations('releases', upload.id)).revision, 0);
  assert.equal(
    (
      await client.annotate('releases', upload.id, 0, {
        labels: ['sdk'],
        metadata: { client: 'node' },
        collections: [],
      })
    ).revision,
    1,
  );
  assert.equal((await client.search('releases', { label: 'sdk' })).items[0].id, upload.id);
  const downloaded = await client.download('releases', upload.id, { start: 1, end: 3 });
  assert.equal(downloaded.status, 206);
  assert.equal(await downloaded.text(), bytes.subarray(1, 4).toString());
  await assert.rejects(
    client.annotate('releases', upload.id, 0, { labels: [], metadata: {}, collections: [] }),
    { status: 409, code: 'conflict' },
  );
  const page = await fetch(address + '/console/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /ProAnima Depot/);
  const unauthorized = await fetch(address + base + '/artifacts');
  assert.equal(unauthorized.status, 401);
});

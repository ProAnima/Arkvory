import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, descriptor, base } from './fixture.mjs';

test('portable SDK uploads parts, edits annotations and streams HTTP ranges', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  const client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
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
  assert.match(await page.text(), /ProAnima Arkvory/);
  for (const [file, type] of [
    ['tokens.css', 'text/css'],
    ['appearance-init.js', 'text/javascript'],
    ['arkvory.svg', 'image/svg\\+xml'],
    ['arkvory.ico', 'image/x-icon'],
    ['arkvory.png', 'image/png'],
  ]) {
    const asset = await fetch(address + '/console/' + file);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), new RegExp(type));
    assert.match(asset.headers.get('content-security-policy'), /script-src 'self'/);
    assert((await asset.text()).length > 0);
  }
  // A dictionary of the console is fetched by its two letters; any other name is not a file.
  const german = await fetch(address + '/console/locales/de.json');
  assert.equal(german.status, 200);
  assert.match(german.headers.get('content-type'), /application\/json/);
  assert.equal(typeof (await german.json()).catalog, 'string');
  for (const name of ['xx.json', 'DE.json', 'de.js', '..%2Fconsole.js', '%2E%2E%2Fconsole.js'])
    assert.equal((await fetch(address + '/console/locales/' + name)).status, 404, name);
  // The flags beside the languages: pictures under the same rule (two letters and .svg).
  const flag = await fetch(address + '/console/flags/gb.svg');
  assert.equal(flag.status, 200);
  assert.match(flag.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(flag.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await flag.text(), /<svg/);
  for (const name of ['xx.svg', 'GB.svg', 'gb.png', 'gb.svg.map', '..%2Fconsole.js', 'LICENSE'])
    assert.equal((await fetch(address + '/console/flags/' + name)).status, 404, name);
  const unauthorized = await fetch(address + base + '/artifacts');
  assert.equal(unauthorized.status, 401);
});

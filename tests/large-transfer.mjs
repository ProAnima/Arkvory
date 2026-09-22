import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { writeFile, mkdir } from 'node:fs/promises';
import { setup, base } from './integration/fixture.mjs';

const cleanups = [];
const f = await setup({ after: (callback) => cleanups.push(callback) });
let child;
let peakRss = 0;
async function start() {
  child = fork('tests/integration/api-child.mjs', [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  child.on('message', (message) => {
    if (message.rss) peakRss = Math.max(peakRss, message.rss);
  });
  child.send(f.config);
  const [message] = await once(child, 'message');
  if (message.error) throw new Error(message.error);
  return message.address;
}
async function stop() {
  if (child && !child.killed) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
}

try {
  await f.app.close();
  let address = await start();
  const chunk = Buffer.alloc(1024 ** 2, 0x5a);
  const size = 5 * 1024 ** 3;
  const expected = createHash('sha256');
  for (let n = 0; n < size / chunk.length; n++) expected.update(chunk);
  const sha256 = expected.digest('hex');
  const reserved = await fetch(address + base + '/uploads', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify({ name: 'large-test.bin', size: String(size), sha256 }),
  });
  assert.equal(reserved.status, 201, await reserved.clone().text());
  const { id } = await reserved.json();
  const started = Date.now();
  const multipart = process.argv.includes('--multipart');
  console.log('Streaming 5 GiB to standalone API...');
  if (multipart) {
    const part = Buffer.alloc(8 * 1024 ** 2, 0x5a);
    const partHash = createHash('sha256').update(part).digest('hex');
    for (let index = 0; index < size / part.length; index++) {
      if (index === 320) {
        await stop();
        address = await start();
        const saved = await fetch(`${address}${base}/uploads/${id}/parts`, { headers: f.headers });
        assert.equal((await saved.json()).items.length, 320);
        console.log('Resuming 5 GiB upload after process kill at part 320...');
      }
      const result = await fetch(`${address}${base}/uploads/${id}/parts/${index}`, {
        method: 'PUT',
        headers: {
          ...f.headers,
          'content-type': 'application/octet-stream',
          'x-content-sha256': partHash,
        },
        body: part,
      });
      assert.equal(result.status, 204, await result.text());
    }
    const result = await fetch(`${address}${base}/uploads/${id}/complete`, {
      method: 'POST',
      headers: f.headers,
    });
    assert.equal(result.status, 200, await result.text());
  } else {
    const upload = await fetch(`${address}${base}/uploads/${id}/content`, {
      method: 'PUT',
      headers: {
        ...f.headers,
        'content-type': 'application/octet-stream',
        'content-length': String(size),
      },
      duplex: 'half',
      body: Readable.from(
        (async function* () {
          for (let n = 0; n < size / chunk.length; n++) yield chunk;
        })(),
        { objectMode: false, highWaterMark: chunk.length },
      ),
    });
    assert.equal(upload.status, 200, await upload.text());
  }
  const uploadMs = Date.now() - started;
  await stop();
  address = await start();
  const range = await fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: { ...f.headers, range: `bytes=${size - 17}-` },
  });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), Buffer.alloc(17, 0x5a));
  const beginRead = Date.now();
  console.log('Verifying full download after process restart...');
  const download = await fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers });
  assert.equal(download.status, 200);
  let received = 0;
  const actual = createHash('sha256');
  for await (const data of download.body) {
    actual.update(data);
    received += data.byteLength;
  }
  assert.equal(received, size);
  assert.equal(actual.digest('hex'), sha256);
  assert(peakRss < 384 * 1024 ** 2, `Server peak RSS ${peakRss} exceeded 384 MiB`);
  const report = {
    date: new Date().toISOString(),
    os: process.platform,
    node: process.version,
    bytes: size,
    sha256,
    uploadMs,
    downloadMs: Date.now() - beginRead,
    peakServerRssBytes: peakRss,
    processRestart: true,
    multipart,
    restartDuringUpload: multipart,
    rangeVerified: true,
    concurrentTransfers: 1,
    storage: 'Local filesystem',
    database: 'PostgreSQL',
  };
  await mkdir('test-results', { recursive: true });
  await writeFile(
    `test-results/${multipart ? 'large-multipart' : 'large-transfer'}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stop();
  for (const cleanup of cleanups.reverse()) await cleanup();
}

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { setup, base } from './integration/fixture.mjs';
import { DepotClient } from '@proanima/depot-sdk';
import { createServer, request } from 'node:http';

const cleanups = [];
const traffic = process.argv.includes('--traffic');
const managed = process.argv.includes('--managed');
const f = await setup(
  { after: (callback) => cleanups.push(callback) },
  traffic
    ? {
        uploadBytesPerSecond: 64 * 1024 ** 2,
        downloadBytesPerSecond: 64 * 1024 ** 2,
        uploadBytesPerSecondPerPrincipal: 48 * 1024 ** 2,
        downloadBytesPerSecondPerPrincipal: 48 * 1024 ** 2,
      }
    : {},
);
let child;
let peakRss = 0;
let peakClientRss = 0;
const memorySample = setInterval(() => {
  peakClientRss = Math.max(peakClientRss, process.memoryUsage().rss);
}, 100);
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

async function uploadFull(address, id, chunk, size) {
  const started = Date.now();
  let written = 0;
  // HTTP writable drain is the backpressure boundary. Avoid fetch buffering the synthetic source.
  const outgoing = request(`${address}${base}/uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'content-length': String(size),
    },
  });
  const reply = new Promise((resolve, reject) => {
    outgoing.once('error', reject);
    outgoing.once('response', (response) => {
      void (async () => {
        let body = '';
        response.setEncoding('utf8');
        for await (const data of response) {
          body += data;
          assert(body.length <= 65536, 'Unexpectedly large upload response');
        }
        assert.equal(response.statusCode, 200, body);
      })().then(resolve, reject);
    });
  });
  try {
    await Promise.all([
      reply,
      (async () => {
        for (let n = 0; n < size / chunk.length; n++) {
          const ready = outgoing.write(chunk);
          written += chunk.length;
          if (!ready) await once(outgoing, 'drain');
        }
        outgoing.end();
      })(),
    ]);
  } catch (error) {
    throw new Error(
      `Full upload failed: written=${written}/${size}, bodyFlushed=${outgoing.writableFinished}, elapsedMs=${Date.now() - started}`,
      { cause: error },
    );
  } finally {
    outgoing.destroy();
  }
}

try {
  if (managed) {
    f.config.keys[0].principal.serviceAdministrator = true;
    const bindings = [
      {
        resource: { kind: 'repository', id: 'releases' },
        actions: [
          'upload.create',
          'upload.read',
          'upload.write',
          'upload.complete',
          'artifact.read',
          'content.read',
        ],
      },
    ];
    const account = await f.app.inject({
      method: 'POST',
      url: '/api/v1/service-accounts',
      headers: f.headers,
      payload: { name: 'large-transfer', bindings },
    });
    assert.equal(account.statusCode, 201, account.body);
    const issued = await f.app.inject({
      method: 'POST',
      url: `/api/v1/service-accounts/${account.json().id}/keys`,
      headers: { ...f.headers, 'idempotency-key': randomUUID() },
      payload: { name: 'large-transfer', bindings },
    });
    assert.equal(issued.statusCode, 201, issued.body);
    f.headers = { authorization: `Bearer ${issued.json().secret}` };
    const activated = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/activate-key',
      headers: f.headers,
    });
    assert.equal(activated.statusCode, 204, activated.body);
  }
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
    await uploadFull(address, id, chunk, size);
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
  const verified = process.argv.includes('--verified');
  let downloadBody;
  let interruptedDownload = false;
  if (verified) {
    const proxy = createServer((incoming, outgoing) => {
      const forward = request(
        new URL(incoming.url, address),
        { headers: incoming.headers },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          if (incoming.url.endsWith('/content') && !interruptedDownload) {
            interruptedDownload = true;
            response.once('data', (chunk) => {
              outgoing.write(chunk.subarray(0, 16));
              setImmediate(() => {
                outgoing.destroy();
                forward.destroy();
              });
            });
          } else response.pipe(outgoing);
          response.on('error', () => outgoing.destroy());
        },
      );
      forward.on('error', () => outgoing.destroy());
      outgoing.on('close', () => forward.destroy());
      incoming.pipe(forward);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    cleanups.push(
      () =>
        new Promise((resolve) => {
          proxy.close(resolve);
          proxy.closeAllConnections();
        }),
    );
    const client = new DepotClient(`http://127.0.0.1:${proxy.address().port}`, () =>
      f.headers.authorization.slice(7),
    );
    downloadBody = await client.downloadVerified('releases', id);
  } else {
    const download = await fetch(`${address}${base}/artifacts/${id}/content`, {
      headers: f.headers,
    });
    assert.equal(download.status, 200);
    downloadBody = download.body;
  }
  let received = 0;
  const actual = createHash('sha256');
  for await (const data of downloadBody) {
    actual.update(data);
    received += data.byteLength;
  }
  assert.equal(received, size);
  assert.equal(actual.digest('hex'), sha256);
  assert(peakRss < 384 * 1024 ** 2, `Server peak RSS ${peakRss} exceeded 384 MiB`);
  assert(peakClientRss < 384 * 1024 ** 2, `Client peak RSS ${peakClientRss} exceeded 384 MiB`);
  if (verified) {
    assert(interruptedDownload);
  }
  const report = {
    date: new Date().toISOString(),
    os: process.platform,
    node: process.version,
    bytes: size,
    sha256,
    uploadMs,
    downloadMs: Date.now() - beginRead,
    peakServerRssBytes: peakRss,
    peakClientRssBytes: peakClientRss,
    verifiedSdkDownload: verified,
    managedServiceKey: managed,
    interruptedDownload,
    trafficPolicy: traffic
      ? { gatewayBytesPerSecond: 64 * 1024 ** 2, principalBytesPerSecond: 48 * 1024 ** 2 }
      : null,
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
    `test-results/${traffic ? 'large-traffic' : verified ? 'large-verified' : multipart ? 'large-multipart' : 'large-transfer'}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearInterval(memorySample);
  await stop();
  for (const cleanup of cleanups.reverse()) await cleanup();
}

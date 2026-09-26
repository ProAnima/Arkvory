import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { truncate, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { LocalBlobStore, DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import { setup, create, base } from './fixture.mjs';

function observeTimeouts(t, prefix = 'upload.') {
  const records = [];
  const original = DiagnosticLogger.prototype.write;
  DiagnosticLogger.prototype.write = function (record) {
    if (record.code.startsWith(prefix)) records.push(record);
    return original.call(this, record);
  };
  t.after(() => {
    DiagnosticLogger.prototype.write = original;
  });
  return records;
}

test('invalid multipart headers reject an unread large body by closing the connection', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('valid small object');
  const id = (await create(f, bytes)).json().id;
  const address = await f.listen();
  const result = await new Promise((resolve, reject) => {
    const outgoing = request(
      `${address}${base}/uploads/${id}/parts/0`,
      {
        method: 'PUT',
        signal: AbortSignal.timeout(2000),
        headers: {
          ...f.headers,
          'content-type': 'application/octet-stream',
          'content-length': 5 * 1024 ** 3,
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          resolve({ status: response.statusCode, connection: response.headers.connection });
          outgoing.destroy();
        });
      },
    );
    outgoing.once('error', reject);
    outgoing.write(bytes.subarray(0, 1));
  });
  assert.deepEqual(result, { status: 400, connection: 'close' });
  await waitForRelease(f);
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.headers })).json().status,
    'pending',
  );
});

test('server backpressure does not spend the client input idle budget', async (t) => {
  const f = await setup(t, { uploadIdleTimeoutMs: 60, uploadDeadlineMs: 5000 });
  f.app.server.setTimeout(60);
  const bytes = Buffer.from('slow durable storage');
  const id = (await create(f, bytes)).json().id;
  const address = await f.listen();
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const original = LocalBlobStore.prototype.put;
  LocalBlobStore.prototype.put = async function (...args) {
    entered.resolve();
    await resume.promise;
    return original.apply(this, args);
  };
  t.after(() => {
    resume.resolve();
    LocalBlobStore.prototype.put = original;
  });
  let settled = false;
  const response = fetch(`${address}${base}/uploads/${id}/content`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(5000),
  }).then(
    (value) => {
      settled = true;
      return { value };
    },
    (error) => {
      settled = true;
      return { error };
    },
  );
  try {
    await Promise.race([
      entered.promise,
      response.then(() => {
        throw new Error('Upload ended before backend entry');
      }),
    ]);
    // Real socket deadline, deliberately shorter than the controlled storage pause.
    await delay(240);
    assert.equal(
      settled,
      false,
      'Socket closed while the backend, not the client, held the transfer',
    );
  } finally {
    resume.resolve();
  }
  const result = await response;
  assert.equal(result.error, undefined);
  assert.equal(result.value.status, 200, await result.value.text());
  // The 60 ms socket budget belongs to the controlled upload experiment. Restore a normal
  // deadline before the independent readback, whose DB lookup can exceed 60 ms on busy hosts.
  f.app.server.setTimeout(5000);
  const download = await fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers });
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('admission timeout closes unread full and multipart bodies without starting storage', async (t) => {
  const f = await setup(t, { maxUploads: 1, transferQueueTimeoutMs: 60 });
  const bytes = Buffer.from('hold the only upload slot');
  const id = (await create(f, bytes)).json().id;
  const address = await f.listen();
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const original = LocalBlobStore.prototype.put;
  let puts = 0;
  LocalBlobStore.prototype.put = async function (...args) {
    puts++;
    entered.resolve();
    await resume.promise;
    return original.apply(this, args);
  };
  t.after(() => {
    resume.resolve();
    LocalBlobStore.prototype.put = original;
  });
  const active = fetch(`${address}${base}/uploads/${id}/content`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(5000),
  });
  try {
    await Promise.race([
      entered.promise,
      active.then(() => {
        throw new Error('Upload ended before backend entry');
      }),
    ]);
    for (const suffix of ['content', 'parts/0']) {
      const result = await new Promise((resolve, reject) => {
        const outgoing = request(
          `${address}${base}/uploads/${id}/${suffix}`,
          {
            method: 'PUT',
            signal: AbortSignal.timeout(2000),
            headers: {
              ...f.headers,
              'content-type': 'application/octet-stream',
              'content-length': 5 * 1024 ** 3,
              'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
            },
          },
          (response) => {
            response.resume();
            response.once('end', () => {
              resolve({ status: response.statusCode, connection: response.headers.connection });
              outgoing.destroy();
            });
          },
        );
        outgoing.once('error', reject);
        outgoing.write(bytes.subarray(0, 1));
      });
      assert.deepEqual(result, { status: 503, connection: 'close' });
    }
    const ready = (await f.app.inject({ url: '/health/ready', headers: f.headers })).json();
    assert.equal(ready.transfers.uploads.admission.active, 1);
    assert.equal(ready.transfers.uploads.admission.waiting, 0);
    assert.equal(ready.transfers.uploads.admission.timedOut, 2);
    assert.equal(puts, 1);
  } finally {
    resume.resolve();
    const response = await active;
    assert.equal(response.status, 200, await response.text());
  }
  await waitForRelease(f);
});

async function waitForRelease(f, direction = 'uploads') {
  const deadline = Date.now() + 3000;
  do {
    const ready = await f.app.inject({ url: '/health/ready', headers: f.headers });
    if (ready.json().transfers[direction].admission.active === 0) return;
    await delay(10);
  } while (Date.now() < deadline);
  assert.fail('Upload admission was not released');
}

test('idle full and multipart senders are disconnected, staging is cleaned and retry remains possible', async (t) => {
  const records = observeTimeouts(t);
  const f = await setup(t, { uploadIdleTimeoutMs: 100, uploadDeadlineMs: 3000 });
  const address = await f.listen();
  const bytes = Buffer.from('all bytes required before publication');
  for (const multipart of [false, true]) {
    const id = (await create(f, bytes)).json().id;
    const path = `${address}${base}/uploads/${id}/${multipart ? 'parts/0' : 'content'}`;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const started = Date.now();
    const stalled = new Promise((resolve, reject) => {
      const outgoing = request(
        path,
        {
          method: 'PUT',
          signal: AbortSignal.timeout(1500),
          headers: {
            ...f.headers,
            'content-type': 'application/octet-stream',
            'content-length': bytes.length,
            ...(multipart ? { 'x-content-sha256': hash } : {}),
          },
        },
        (response) => {
          response.resume();
          reject(new Error(`Unexpected response ${response.statusCode}`));
        },
      );
      outgoing.once('error', resolve);
      outgoing.write(bytes.subarray(0, 1));
    });
    await stalled;
    assert(
      Date.now() - started < 1200,
      'Client watchdog, not the server idle budget, stopped the upload',
    );
    await waitForRelease(f);
    const status = await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.headers });
    assert.equal(status.json().status, 'pending');
    assert.deepEqual(await f.catalog.parts(id), []);
    const staging = join(f.directory, 'staging', id);
    assert.deepEqual(await readdir(staging), []);
    const retry = await fetch(path, {
      method: 'PUT',
      headers: {
        ...f.headers,
        'content-type': 'application/octet-stream',
        ...(multipart ? { 'x-content-sha256': hash } : {}),
      },
      body: bytes,
    });
    assert.equal(retry.status, multipart ? 204 : 200, await retry.text());
    if (multipart) {
      const completed = await fetch(`${address}${base}/uploads/${id}/complete`, {
        method: 'POST',
        headers: f.headers,
      });
      assert.equal(completed.status, 200, await completed.text());
    }
  }
  assert.deepEqual(
    records.map((r) => r.code),
    ['upload.input_timeout', 'upload.input_timeout'],
  );
  assert(records.every((r) => r.route.includes(':id') && r.level === 'warning' && r.requestId));
  assert(!JSON.stringify(records).includes(f.headers.authorization));
});

test('operation deadline cancels a blocked backend and prevents publication after it resumes', async (t) => {
  const records = observeTimeouts(t);
  const f = await setup(t, { uploadIdleTimeoutMs: 100, uploadDeadlineMs: 250 });
  const bytes = Buffer.from('must remain pending');
  const id = (await create(f, bytes)).json().id;
  const address = await f.listen();
  const held = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const original = LocalBlobStore.prototype.put;
  LocalBlobStore.prototype.put = async function (...args) {
    entered.resolve();
    await held.promise;
    return original.apply(this, args);
  };
  t.after(() => {
    held.resolve();
    LocalBlobStore.prototype.put = original;
  });
  const started = Date.now();
  const result = fetch(`${address}${base}/uploads/${id}/content`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: bytes,
    signal: AbortSignal.timeout(1500),
  }).then(
    () => 'unexpected success',
    () => 'interrupted',
  );
  try {
    await Promise.race([
      entered.promise,
      result.then(() => {
        throw new Error('Upload ended before backend entry');
      }),
    ]);
    assert.equal(await result, 'interrupted');
    assert(Date.now() - started < 1200, 'Server did not enforce its absolute deadline');
  } finally {
    held.resolve();
  }
  await waitForRelease(f);
  assert.deepEqual(
    records.map((r) => r.code),
    ['upload.deadline'],
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.headers })).json().status,
    'pending',
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).statusCode,
    404,
  );
});

test('a truncated blob aborts native full/Range and legacy responses and releases download admission', async (t) => {
  const records = observeTimeouts(t, 'download.');
  const f = await setup(t);
  const address = await f.listen();
  const client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const bytes = Buffer.alloc(2 * 1024 ** 2, 0x5c);
  const original = LocalBlobStore.prototype.read;
  LocalBlobStore.prototype.read = async function* (id, size, range) {
    const source = original.call(this, id, size, range);
    let cut = false;
    for await (const chunk of source) {
      yield chunk;
      if (!cut) {
        cut = true;
        await truncate(this.contentPath(id), 0);
      }
    }
  };
  t.after(() => {
    LocalBlobStore.prototype.read = original;
  });
  for (const mode of ['full', 'range', 'legacy']) {
    const id = (await create(f, bytes)).json().id;
    const sent = await fetch(`${address}${base}/uploads/${id}/content`, {
      method: 'PUT',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    assert.equal(sent.status, 200, await sent.text());
    if (mode === 'legacy') await client.setAsset('releases', 'cut.bin', id, 0);
    const path =
      mode === 'legacy' ? '/endpoints/releases/content/cut.bin' : `${base}/artifacts/${id}/content`;
    const started = Date.now();
    const response = await fetch(address + path, {
      headers: {
        ...f.headers,
        ...(mode === 'range' ? { range: `bytes=0-${bytes.length - 1}` } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, mode === 'range' ? 206 : 200);
    await assert.rejects(response.arrayBuffer());
    assert(Date.now() - started < 3000, 'Incomplete response was not aborted before the watchdog');
    await waitForRelease(f, 'downloads');
  }
  assert.deepEqual(
    records.map((r) => r.code),
    Array(3).fill('download.integrity_mismatch'),
  );
  assert(records.every((r) => r.level === 'error' && r.requestId));
  assert(!JSON.stringify(records).includes(f.headers.authorization));
});

test('completion deadline also covers validation of an already durable unpublished blob', async (t) => {
  const f = await setup(t, { uploadIdleTimeoutMs: 100, uploadDeadlineMs: 250 });
  const bytes = Buffer.from('durable but unpublished');
  const id = (await create(f, bytes)).json().id;
  const store = new LocalBlobStore(f.directory, 0);
  await store.put(
    id,
    {
      name: 'artifact.upack',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: [],
      metadata: {},
    },
    (async function* () {
      yield bytes;
    })(),
    { throwIfAborted() {} },
  );
  const held = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const original = LocalBlobStore.prototype.verify;
  LocalBlobStore.prototype.verify = async function (...args) {
    entered.resolve();
    await held.promise;
    return original.apply(this, args);
  };
  t.after(() => {
    held.resolve();
    LocalBlobStore.prototype.verify = original;
  });
  const address = await f.listen();
  const started = Date.now();
  const result = fetch(`${address}${base}/uploads/${id}/complete`, {
    method: 'POST',
    headers: f.headers,
    signal: AbortSignal.timeout(1500),
  }).then(
    () => 'unexpected success',
    () => 'interrupted',
  );
  try {
    await Promise.race([
      entered.promise,
      result.then(() => {
        throw new Error('Completion ended before backend entry');
      }),
    ]);
    assert.equal(await result, 'interrupted');
    assert(Date.now() - started < 1200);
  } finally {
    held.resolve();
  }
  await waitForRelease(f);
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.headers })).json().status,
    'pending',
  );
  LocalBlobStore.prototype.verify = original;
  const retry = await fetch(`${address}${base}/uploads/${id}/complete`, {
    method: 'POST',
    headers: f.headers,
  });
  assert.equal(retry.status, 200, await retry.text());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  ArkvoryClient,
  ArkvoryIntegrityError,
  ArkvoryHttpError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

const partBytes = 8 * 1024 ** 2;
const policy = { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3, attemptTimeoutMs: 1000 };
test('package JSON remains bounded after allowing large manifest pages', async (t) => {
  const { client } = await serve(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('x'.repeat(8 * 1024 ** 2 + 1));
  });
  await assert.rejects(client.packages('releases'), /Response exceeds SDK limit/);
});
function artifact(bytes) {
  return {
    id: 'test-id',
    repository: 'releases',
    status: 'available',
    createdAt: '',
    expiresAt: '',
    descriptor: {
      name: 'file',
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: [],
      metadata: {},
    },
  };
}
async function serve(t, handler, settings = policy) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const address = `http://127.0.0.1:${server.address().port}`;
  return { client: new ArkvoryClient(address, () => 'test-token', settings), address };
}
function range(req, res, bytes, meta, alter = {}) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
  assert(match);
  const start = Number(match[1]),
    end = Number(match[2]);
  assert.equal(req.headers['if-range'], `"sha256:${meta.descriptor.sha256}"`);
  res.writeHead(alter.status ?? 206, {
    'Content-Length': String(end - start + 1),
    'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
    ETag: `"sha256:${meta.descriptor.sha256}"`,
    ...alter.headers,
  });
  return bytes.subarray(start, end + 1);
}
async function contents(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

test('verified download retries a real mid-body disconnect without duplicate bytes', async (t) => {
  const bytes = Buffer.alloc(partBytes + 113, 0x37),
    meta = artifact(bytes),
    ranges = [];
  let cuts = 0;
  const { client } = await serve(t, (req, res) => {
    if (!req.url.endsWith('/content')) return res.end(JSON.stringify(meta));
    ranges.push(req.headers.range);
    const body = range(req, res, bytes, meta);
    if (ranges.length === 2 && cuts++ === 0) {
      res.write(body.subarray(0, 32));
      setImmediate(() => res.destroy());
    } else res.end(body);
  });
  const result = await contents(await client.downloadVerified('releases', meta.id));
  assert.deepEqual(result, bytes);
  assert.deepEqual(ranges, [
    `bytes=0-${partBytes - 1}`,
    `bytes=${partBytes}-${bytes.length - 1}`,
    `bytes=${partBytes}-${bytes.length - 1}`,
  ]);
});

test('a new client resumes from a saved prefix and checks the hash of the whole file', async (t) => {
  const bytes = Buffer.alloc(partBytes + 131, 0x2a),
    meta = artifact(bytes),
    ranges = [];
  const { address } = await serve(t, (req, res) => {
    if (!req.url.endsWith('/content')) return res.end(JSON.stringify(meta));
    ranges.push(req.headers.range);
    res.end(range(req, res, bytes, meta));
  });
  const first = new ArkvoryClient(address, () => 'test', policy);
  const reader = (await first.downloadVerified('releases', meta.id)).getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const second = new ArkvoryClient(address, () => 'test', policy);
  const suffix = await contents(
    await second.downloadVerified('releases', meta.id, { prefix: new Blob([value]) }),
  );
  assert.deepEqual(Buffer.concat([value, suffix]), bytes);
  assert.equal(ranges.length, 2);
  await assert.rejects(
    contents(
      await second.downloadVerified('releases', meta.id, {
        prefix: new Blob([Buffer.alloc(partBytes)]),
      }),
    ),
    ArkvoryIntegrityError,
  );
  const complete = await contents(
    await second.downloadVerified('releases', meta.id, { prefix: new Blob([bytes]) }),
  );
  assert.equal(complete.length, 0);
});

test('empty files close only after checksum validation', async (t) => {
  const meta = artifact(Buffer.alloc(0));
  const { client } = await serve(t, (_req, res) => res.end(JSON.stringify(meta)));
  assert.equal((await contents(await client.downloadVerified('releases', meta.id))).length, 0);
  meta.descriptor.sha256 = 'a'.repeat(64);
  await assert.rejects(
    contents(await client.downloadVerified('releases', meta.id)),
    ArkvoryIntegrityError,
  );
});

test('range, validator, encoding and checksum violations abort the destination without retries', async (t) => {
  for (const alter of [
    { status: 200 },
    { headers: { ETag: '"other"' } },
    { headers: { 'Content-Range': 'bytes 1-4/5' } },
    { headers: { 'Content-Length': '99' } },
    { headers: { 'Content-Encoding': 'gzip' } },
    { corrupt: true },
  ]) {
    await t.test(JSON.stringify(alter), async (t) => {
      const bytes = Buffer.from('hello'),
        meta = artifact(bytes);
      let requests = 0,
        closed = false,
        aborted = false;
      const { client } = await serve(t, (req, res) => {
        if (!req.url.endsWith('/content')) return res.end(JSON.stringify(meta));
        requests++;
        res.end(
          alter.corrupt
            ? (range(req, res, bytes, meta), Buffer.from('wrong'))
            : range(req, res, bytes, meta, alter),
        );
      });
      const stream = await client.downloadVerified('releases', meta.id);
      await assert.rejects(
        stream.pipeTo(
          new WritableStream({
            close() {
              closed = true;
            },
            abort() {
              aborted = true;
            },
          }),
        ),
        ArkvoryIntegrityError,
      );
      assert.equal(requests, 1);
      assert.equal(closed, false);
      assert.equal(aborted, true);
    });
  }
});

test('bounded retries, Retry-After, cancellation and attempt deadlines', async (t) => {
  await t.test('limits repeated connection loss', async (t) => {
    let count = 0;
    const { client } = await serve(t, (_req, res) => {
      count++;
      res.destroy();
    });
    await assert.rejects(client.downloadVerified('releases', 'id'), ArkvoryNetworkError);
    assert.equal(count, 3);
  });
  await t.test(
    'does not retry permission errors or wait beyond policy for Retry-After',
    async (t) => {
      for (const status of [401, 403, 409, 422, 429, 503]) {
        let count = 0;
        const { client } = await serve(t, (_req, res) => {
          count++;
          res.writeHead(status, { 'Retry-After': '120' });
          res.end('{}');
        });
        await assert.rejects(client.downloadVerified('releases', 'id'), ArkvoryHttpError);
        assert.equal(count, 1);
      }
    },
  );
  await t.test('500 internal is final while transient 503 is retried', async (t) => {
    for (const [status, code, expected] of [
      [500, 'internal', 1],
      [503, 'unavailable', 3],
    ]) {
      let count = 0;
      const { client } = await serve(t, (_req, res) => {
        count++;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code, message: 'failure', requestId: 'r' }));
      });
      await assert.rejects(client.downloadVerified('releases', 'id'), { status, code });
      assert.equal(count, expected, `${status} attempts`);
    }
  });
  await t.test('abort stops backoff before another request', async (t) => {
    let count = 0;
    const controller = new AbortController();
    const { client } = await serve(t, (_req, res) => {
      count++;
      res.writeHead(503);
      res.end('{}');
    });
    await assert.rejects(
      client.downloadVerified('releases', 'id', {
        signal: controller.signal,
        onRetry() {
          controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(count, 1);
  });
  await t.test('body stalls time out and release the connection', async (t) => {
    let count = 0;
    const { client } = await serve(
      t,
      (_req, res) => {
        count++;
        res.writeHead(200);
        res.write('{');
      },
      { ...policy, attemptTimeoutMs: 50, maxAttempts: 2 },
    );
    await assert.rejects(client.downloadVerified('releases', 'id'), ArkvoryNetworkError);
    assert.equal(count, 2);
  });
  await t.test('CAS metadata is never retried automatically', async (t) => {
    let count = 0;
    const { client } = await serve(t, (_req, res) => {
      count++;
      res.destroy();
    });
    await assert.rejects(
      client.annotate('releases', 'id', 0, { labels: [], metadata: {}, collections: [] }),
      ArkvoryNetworkError,
    );
    assert.equal(count, 1);
  });
});

test('one download shares the retry budget across all ranges', async (t) => {
  const bytes = Buffer.alloc(partBytes + 1, 0x49),
    meta = artifact(bytes),
    seen = new Set();
  let retries = 0;
  const { client } = await serve(
    t,
    (req, res) => {
      if (!req.url.endsWith('/content')) return res.end(JSON.stringify(meta));
      if (!seen.has(req.headers.range)) {
        seen.add(req.headers.range);
        res.destroy();
        return;
      }
      res.end(range(req, res, bytes, meta));
    },
    { ...policy, maxRetries: 1 },
  );
  await assert.rejects(
    contents(
      await client.downloadVerified('releases', meta.id, {
        onRetry() {
          retries++;
        },
      }),
    ),
    ArkvoryNetworkError,
  );
  assert.equal(retries, 1);
});

test('Retry-After is respected and cancelling a pending range releases its socket', async (t) => {
  await t.test('successful retry waits for server admission', async (t) => {
    const meta = artifact(Buffer.alloc(0));
    let count = 0;
    const { client } = await serve(
      t,
      (_req, res) => {
        if (++count === 1) {
          res.writeHead(503, { 'Retry-After': '1' });
          res.end('{}');
        } else res.end(JSON.stringify(meta));
      },
      { ...policy, maxDelayMs: 1500 },
    );
    const started = performance.now();
    await contents(await client.downloadVerified('releases', meta.id));
    assert(performance.now() - started >= 950);
    assert.equal(count, 2);
  });
  await t.test('stream cancellation aborts an in-flight fetch', async (t) => {
    const bytes = Buffer.alloc(128),
      meta = artifact(bytes);
    let ready, closed;
    const rangeStarted = new Promise((resolve) => {
      ready = resolve;
    });
    const socketClosed = new Promise((resolve) => {
      closed = resolve;
    });
    const { client } = await serve(t, (req, res) => {
      if (!req.url.endsWith('/content')) return res.end(JSON.stringify(meta));
      range(req, res, bytes, meta);
      res.write(bytes.subarray(0, 1));
      res.once('close', closed);
      ready();
    });
    const reader = (await client.downloadVerified('releases', meta.id)).getReader();
    const pending = reader.read();
    await rangeStarted;
    await reader.cancel();
    assert.equal((await pending).done, true);
    await socketClosed;
  });
});

test('large uploads complete through the worker and surface a failed job', async () => {
  const { completeWithWorker } = await import('../packages/sdk/dist/upload-transfer.js');
  const attempts = { run: (operation) => operation(new AbortController().signal) };
  const states = ['queued', 'running', 'completed'];
  const calls = [];
  const uploads = {
    enqueue: async (repository, id) => {
      calls.push(`enqueue ${repository} ${id}`);
      return { id: 'job-1', uploadId: id, status: 'queued', attempts: 0, errorCode: null };
    },
    job: async (id) => {
      calls.push(`job ${id}`);
      return { id, uploadId: 'u', status: states.shift(), attempts: 1, errorCode: null };
    },
    status: async (repository, id) => {
      calls.push(`status ${id}`);
      return { id, status: 'available' };
    },
  };
  const done = await completeWithWorker(uploads, attempts, 'releases', 'u', undefined, 1);
  assert.equal(done.status, 'available');
  assert.deepEqual(calls, [
    'enqueue releases u',
    'job job-1',
    'job job-1',
    'job job-1',
    'status u',
  ]);
  const failing = {
    ...uploads,
    job: async (id) => ({ id, uploadId: 'u', status: 'failed', attempts: 5, errorCode: 'busy' }),
  };
  await assert.rejects(
    completeWithWorker(failing, attempts, 'releases', 'u', undefined, 1),
    /completion failed: busy/,
  );
  const stop = new AbortController();
  const waiting = {
    ...uploads,
    job: async (id) => {
      stop.abort();
      return { id, uploadId: 'u', status: 'queued', attempts: 0, errorCode: null };
    },
  };
  await assert.rejects(completeWithWorker(waiting, attempts, 'releases', 'u', stop.signal, 1));
});

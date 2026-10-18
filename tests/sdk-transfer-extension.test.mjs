import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  ArkvoryClient,
  ArkvoryClientError,
  ArkvoryIntegrityError,
  chooseTransfer,
} from '@proanima/arkvory-sdk';

const policy = { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: 3, attemptTimeoutMs: 2000 };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PREFIX = '/api/ext/test-delta/v2/';

function artifact(bytes, status = 'available', sha = sha256(bytes)) {
  return {
    id: 'a1',
    repository: 'releases',
    status,
    createdAt: '2026-10-18T00:00:00Z',
    expiresAt: '2026-10-19T00:00:00Z',
    descriptor: {
      name: 'file.bin',
      size: String(bytes.length),
      sha256: sha,
      labels: [],
      metadata: {},
    },
  };
}

/**
 * A server with one artifact: capabilities (with `transfer` unless `offers` is undefined), the
 * artifact, its content ranges (`serve` may alter the bytes) and the module route `blob`.
 */
async function server(t, bytes, options = {}) {
  const meta = artifact(bytes);
  const requests = [];
  const content = options.content ?? bytes;
  const http = createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers.range ?? ''}`.trim());
    if (req.url === '/api/v1/capabilities') {
      const body = {
        apiVersions: ['v1'],
        gatewayRole: 'api',
        features: {},
        limits: {
          maxObjectBytes: '1000000',
          partBytes: 8388608,
          maxPartBytes: 1073741824,
          maxParts: 10000,
          maxPageSize: 1000,
        },
        ...(options.offers === undefined ? {} : { transfer: options.offers }),
      };
      return res.end(JSON.stringify(body));
    }
    if (req.url.startsWith(PREFIX)) {
      assert.equal(req.headers.authorization, 'Bearer test-token');
      return res.end(options.module ?? bytes);
    }
    if (req.url.endsWith('/content')) {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range).map(Number);
      res.writeHead(206, {
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        ETag: `"sha256:${meta.descriptor.sha256}"`,
      });
      return res.end(content.subarray(start, end + 1));
    }
    if (options.upload) return options.upload(req, res, meta);
    return res.end(JSON.stringify(meta));
  });
  http.listen(0, '127.0.0.1');
  await new Promise((resolve) => http.once('listening', resolve));
  t.after(() => new Promise((resolve) => (http.close(resolve), http.closeAllConnections())));
  const events = [];
  const client = new ArkvoryClient(`http://127.0.0.1:${http.address().port}`, () => 'test-token', {
    ...policy,
    transferExtensions: options.extensions ?? [],
    ...(options.mode ? { transferMode: options.mode } : {}),
    onTransfer: (event) => events.push(event),
  });
  return { client, requests, events, meta };
}

const offer = (versions = [2, 3]) => [
  { name: 'test-delta', versions, module: 'test-delta', prefix: PREFIX },
];

/** A test extension that fetches the content from its module route and yields it in pieces. */
function testExtension(overrides = {}) {
  return {
    name: 'test-delta',
    versions: [1, 2],
    plans: [],
    async download(plan, signal) {
      this.plans.push(plan);
      const response = await plan.channel.request('blob', { method: 'GET' }, signal);
      const chunks = [];
      for await (const chunk of response.body) chunks.push(chunk);
      const all = Buffer.concat(chunks).subarray(plan.offset);
      return (async function* () {
        for (let at = 0; at < all.length; at += 3) yield all.subarray(at, at + 3);
      })();
    },
    ...overrides,
  };
}

const read = async (stream) => Buffer.from(await new Response(stream).arrayBuffer());

test('the highest common version of the first offered extension is chosen', () => {
  const a = { name: 'aaa', versions: [1, 4] };
  const b = { name: 'bbb', versions: [1, 2, 3] };
  const offers = [
    { name: 'bbb', versions: [2, 3], module: 'bb', prefix: '/api/ext/bb/v1/' },
    { name: 'aaa', versions: [2, 3], module: 'aa', prefix: '/api/ext/aa/v1/' },
  ];
  assert.deepEqual(chooseTransfer([a, b], offers)?.offer, {
    name: 'bbb',
    version: 3,
    module: 'bb',
    prefix: '/api/ext/bb/v1/',
  });
  assert.equal(chooseTransfer([a], offers), null);
  // A prefix outside /api/ext/<id>/v<major>/ is never used.
  assert.equal(chooseTransfer([b], [{ ...offers[0], prefix: '/admin/' }]), null);
});

test('an agreed extension carries the download and the SDK verifies it', async (t) => {
  const bytes = Buffer.from('the content of the artifact, a few dozen bytes');
  const extension = testExtension();
  const { client, requests, events } = await server(t, bytes, {
    offers: offer(),
    extensions: [extension],
  });
  assert.deepEqual(await read(await client.downloadVerified('releases', 'a1')), bytes);
  assert.equal(extension.plans[0].offer.version, 2);
  assert.equal(extension.plans[0].sha256, sha256(bytes));
  assert.deepEqual(events, [
    { operation: 'download', extension: { name: 'test-delta', version: 2 } },
  ]);
  assert.equal(requests.filter((r) => r.includes('/content')).length, 0);
  // The capabilities are read once per client.
  await read(await client.downloadVerified('releases', 'a1'));
  assert.equal(requests.filter((r) => r.includes('capabilities')).length, 1);
});

test('without a common version or without capabilities.transfer the core transfer runs', async (t) => {
  const bytes = Buffer.from('core transfer bytes');
  for (const offers of [offer([3]), undefined]) {
    const extension = testExtension();
    const { client, events } = await server(t, bytes, { offers, extensions: [extension] });
    assert.deepEqual(await read(await client.downloadVerified('releases', 'a1')), bytes);
    assert.equal(extension.plans.length, 0);
    assert.deepEqual(events, [{ operation: 'download', extension: null }]);
  }
});

test('a declining or failing extension falls back, except in strict mode', async (t) => {
  const bytes = Buffer.from('fallback bytes of the artifact');
  const declining = testExtension({ download: async () => null });
  const failing = testExtension({
    download: async () => {
      throw new Error('module route refused');
    },
  });
  for (const [extension, fallback] of [
    [declining, 'declined'],
    [failing, 'failed'],
  ]) {
    const { client, events } = await server(t, bytes, { offers: offer(), extensions: [extension] });
    assert.deepEqual(await read(await client.downloadVerified('releases', 'a1')), bytes);
    assert.deepEqual(events, [{ operation: 'download', extension: null, fallback }]);
    const strict = await server(t, bytes, {
      offers: offer(),
      extensions: [extension],
      mode: 'strict',
    });
    await assert.rejects(strict.client.downloadVerified('releases', 'a1'));
  }
  const none = await server(t, bytes, {
    offers: offer([9]),
    extensions: [testExtension()],
    mode: 'strict',
  });
  await assert.rejects(
    none.client.downloadVerified('releases', 'a1'),
    (error) => error instanceof ArkvoryClientError && error.code === 'transfer_unavailable',
  );
});

test('a stream that breaks off is continued by the core transfer from where it stopped', async (t) => {
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const extension = testExtension({
    async download() {
      return (async function* () {
        yield bytes.subarray(0, 10);
        throw new Error('connection to the module lost');
      })();
    },
  });
  const { client, requests, events } = await server(t, bytes, {
    offers: offer(),
    extensions: [extension],
  });
  assert.deepEqual(await read(await client.downloadVerified('releases', 'a1')), bytes);
  assert.deepEqual(
    requests.filter((r) => r.includes('/content')),
    [`GET /api/v1/repositories/releases/artifacts/a1/content bytes=10-${bytes.length - 1}`],
  );
  assert.equal(events.at(-1).fallback, 'failed');
  const ended = testExtension({
    async download() {
      return (async function* () {
        yield bytes.subarray(0, 5);
      })();
    },
  });
  const short = await server(t, bytes, { offers: offer(), extensions: [ended] });
  assert.deepEqual(await read(await short.client.downloadVerified('releases', 'a1')), bytes);
  assert.equal(short.events.at(-1).fallback, 'incomplete');
});

test('a substituted byte is checksum_mismatch through the extension and the core transfer', async (t) => {
  const bytes = Buffer.from('bytes that must arrive unchanged');
  const forged = Buffer.from(bytes);
  forged[7] ^= 1;
  const viaModule = await server(t, bytes, {
    offers: offer(),
    extensions: [testExtension()],
    module: forged,
  });
  await assert.rejects(
    read(await viaModule.client.downloadVerified('releases', 'a1')),
    ArkvoryIntegrityError,
  );
  const viaCore = await server(t, bytes, {
    offers: offer([7]),
    content: forged,
    extensions: [testExtension()],
  });
  await assert.rejects(
    read(await viaCore.client.downloadVerified('releases', 'a1')),
    ArkvoryIntegrityError,
  );
  // More bytes than the artifact has are never passed on.
  const longer = await server(t, bytes, {
    offers: offer(),
    extensions: [testExtension()],
    module: Buffer.concat([bytes, Buffer.from('!')]),
  });
  await assert.rejects(
    read(await longer.client.downloadVerified('releases', 'a1')),
    ArkvoryIntegrityError,
  );
});

test('a resumed download asks the extension only for the bytes after the saved prefix', async (t) => {
  const bytes = Buffer.from('prefix-and-the-rest-of-the-content');
  const extension = testExtension();
  const { client } = await server(t, bytes, { offers: offer(), extensions: [extension] });
  const stream = await client.downloadVerified('releases', 'a1', {
    prefix: new Blob([bytes.subarray(0, 7)]),
  });
  assert.deepEqual(await read(stream), bytes.subarray(7));
  assert.equal(extension.plans[0].offset, 7);
  // readRange reads verified ranges of the core content route only.
  const ranged = testExtension({
    async download(plan, signal) {
      const head = await plan.readRange(0, 3, signal);
      return (async function* () {
        yield head;
        yield bytes.subarray(4);
      })();
    },
  });
  const second = await server(t, bytes, { offers: offer(), extensions: [ranged] });
  assert.deepEqual(await read(await second.client.downloadVerified('releases', 'a1')), bytes);
});

test('the channel stays under the module prefix', async (t) => {
  const bytes = Buffer.from('x');
  let failure;
  const extension = testExtension({
    async download(plan, signal) {
      for (const path of [
        '../../v1/system',
        '/api/v1/system',
        'a/../../b',
        'https://evil.example/',
        '%2E%2e/x',
        'a//b',
      ]) {
        await assert.rejects(
          plan.channel.request(path, { method: 'GET' }, signal),
          (error) => error instanceof ArkvoryClientError && error.code === 'invalid_argument',
        );
      }
      failure = 'checked';
      return null;
    },
  });
  const { client } = await server(t, bytes, { offers: offer(), extensions: [extension] });
  await read(await client.downloadVerified('releases', 'a1'));
  assert.equal(failure, 'checked');
  assert.throws(
    () =>
      new ArkvoryClient('http://127.0.0.1:1', () => 't', {
        transferExtensions: [{ name: 'X', versions: [1] }],
      }),
    (error) => error.code === 'invalid_argument',
  );
});

test('an extension upload is accepted only when the published upload is the one asked for', async (t) => {
  const bytes = Buffer.from('upload content');
  const upload = (state) => (req, res, meta) => {
    if (req.method === 'GET' && req.url.endsWith('/uploads/u1')) {
      const status = state.sent ? 'available' : 'pending';
      const sha =
        state.forged && state.sent ? sha256(Buffer.from('other')) : meta.descriptor.sha256;
      return res.end(JSON.stringify({ ...artifact(bytes, status, sha), id: 'u1' }));
    }
    res.statusCode = 500;
    res.end('{}');
  };
  const sender = (state, result = true) => ({
    name: 'test-delta',
    versions: [2],
    async upload(plan, signal) {
      assert.equal(plan.uploadId, 'u1');
      assert.deepEqual(Buffer.from(await plan.read(0, bytes.length - 1, signal)), bytes);
      state.sent = result;
      return result;
    },
  });
  const ok = {};
  const first = await server(t, bytes, {
    offers: offer(),
    extensions: [sender(ok)],
    upload: upload(ok),
  });
  const done = await first.client.resume('releases', 'u1', new Blob([bytes]));
  assert.equal(done.status, 'available');
  assert.deepEqual(first.events, [
    { operation: 'upload', extension: { name: 'test-delta', version: 2 } },
  ]);
  const forged = { forged: true };
  const second = await server(t, bytes, {
    offers: offer(),
    extensions: [sender(forged)],
    upload: upload(forged),
  });
  await assert.rejects(
    second.client.resume('releases', 'u1', new Blob([bytes])),
    ArkvoryIntegrityError,
  );
  // A declining extension in strict mode refuses instead of falling back.
  const declined = {};
  const third = await server(t, bytes, {
    offers: offer(),
    extensions: [sender(declined, false)],
    upload: upload(declined),
    mode: 'strict',
  });
  await assert.rejects(
    third.client.resume('releases', 'u1', new Blob([bytes])),
    (error) => error.code === 'transfer_unavailable',
  );
});

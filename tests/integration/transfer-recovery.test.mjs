import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, descriptor } from './fixture.mjs';

test('SDK recovers upload socket loss and lost create/part/publication responses against PostgreSQL', async (t) => {
  const f = await setup(t),
    upstream = await f.listen();
  const calls = new Map();
  let cutUpload = false;
  const proxy = createServer((incoming, outgoing) => {
    const key = `${incoming.method} ${incoming.url}`;
    const attempt = (calls.get(key) ?? 0) + 1;
    calls.set(key, attempt);
    const forward = request(
      new URL(incoming.url, upstream),
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        const drop =
          (incoming.method === 'POST' && attempt === 1) ||
          (incoming.method === 'PUT' && incoming.url.endsWith('/content') && attempt === 1) ||
          (incoming.url.endsWith('/parts/0') && attempt === 2);
        if (drop) {
          response.resume();
          response.on('end', () => outgoing.destroy());
        } else {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        }
        response.on('error', () => outgoing.destroy());
      },
    );
    forward.on('error', () => outgoing.destroy());
    incoming.on('error', () => forward.destroy());
    if (incoming.url.endsWith('/parts/0') && !cutUpload) {
      cutUpload = true;
      incoming.once('data', (chunk) => {
        forward.write(chunk.subarray(0, 16));
        forward.destroy();
        outgoing.destroy();
      });
    } else incoming.pipe(forward);
  });
  proxy.listen(0, '127.0.0.1');
  await new Promise((resolve) => proxy.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        proxy.close(resolve);
        proxy.closeAllConnections();
      }),
  );
  const client = new ArkvoryClient(
    `http://127.0.0.1:${proxy.address().port}`,
    () => f.headers.authorization.slice(7),
    {
      baseDelayMs: 10,
      maxDelayMs: 50,
      maxAttempts: 5,
    },
  );
  const data = Buffer.alloc(8 * 1024 ** 2 + 317, 0x47);
  const key = randomUUID();
  const upload = await client.create('releases', key, descriptor(data));
  const progress = [];
  assert.equal(
    (
      await client.resume('releases', upload.id, new Blob([data]), {
        onProgress: (bytes) => progress.push(bytes),
      })
    ).status,
    'available',
  );
  assert.deepEqual(progress, [8 * 1024 ** 2, data.length]);
  assert.equal((await client.parts('releases', upload.id)).items.length, 2);
  assert.equal((await client.list('releases')).items.length, 1);
  assert.equal((await client.create('releases', key, descriptor(data))).id, upload.id);
  assert.equal(cutUpload, true);
  assert.equal(calls.get(`PUT /api/v1/repositories/releases/uploads/${upload.id}/parts/0`), 3);
  assert.equal(calls.get(`POST /api/v1/repositories/releases/uploads/${upload.id}/complete`), 2);
  const stream = await client.downloadVerified('releases', upload.id);
  assert.deepEqual(Buffer.from(await new Response(stream).arrayBuffer()), data);
  const empty = await client.create('releases', randomUUID(), descriptor(Buffer.alloc(0)));
  assert.equal((await client.resume('releases', empty.id, new Blob([]))).status, 'available');
  assert.equal(calls.get(`PUT /api/v1/repositories/releases/uploads/${empty.id}/content`), 1);
});

test('upload CLI resumes saved parts and refuses a changed source file', async (t) => {
  const f = await setup(t),
    address = await f.listen();
  const client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const bytes = Buffer.alloc(8 * 1024 ** 2 + 17, 0x63);
  const file = join(f.directory, 'cli-source.bin');
  const tokenFile = join(f.directory, 'cli-token');
  await writeFile(file, bytes);
  await writeFile(tokenFile, f.headers.authorization.slice(7));
  const upload = await client.create('releases', randomUUID(), descriptor(bytes));
  const stop = new AbortController();
  await assert.rejects(
    client.resume('releases', upload.id, new Blob([bytes]), {
      signal: stop.signal,
      onProgress() {
        stop.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal((await client.parts('releases', upload.id)).items.length, 1);
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/upload.mjs', file, 'releases', upload.id], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ARKVORY_BASE_URL: address,
          ARKVORY_TOKEN_FILE: tokenFile,
          ARKVORY_TOKEN: '',
        },
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, output }));
    });
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Published artifact:/);
  assert.equal((await client.status('releases', upload.id)).status, 'available');
  await writeFile(file, Buffer.alloc(bytes.length, 0x64));
  const changed = await run();
  assert.notEqual(changed.code, 0);
  assert.match(changed.output, /Selected file does not match/);
});

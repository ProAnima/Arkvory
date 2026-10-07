import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresWebhookState, verifyWebhook } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, create, base } from './fixture.mjs';

const secret = 'process-test-signing-secret-01';

async function publish(f, text) {
  const bytes = Buffer.from(text);
  const id = (await create(f, bytes)).json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

async function receiver(t, answer) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(answer());
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { requests, port: server.address().port };
}

async function files(t, f, webhooks) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-webhook-process-'));
  t.after(() => removeTestDirectory(directory));
  const paths = {
    keys: join(directory, 'keys.json'),
    secret: join(directory, 'hook.secret'),
    webhooks: join(directory, 'webhooks.json'),
  };
  await writeFile(
    paths.keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  await writeFile(paths.secret, secret);
  await writeFile(paths.webhooks, JSON.stringify(webhooks(paths)));
  return paths;
}

/** The production worker process, delivering webhooks next to the API of the fixture. */
function worker(t, f, paths) {
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ARKVORY_DATABASE_URL: f.config.databaseUrl,
      ARKVORY_DATA_DIR: f.directory,
      ARKVORY_KEYS_FILE: paths.keys,
      ARKVORY_WEBHOOKS_FILE: paths.webhooks,
    },
  });
  const handle = { child, output: '', ended: once(child, 'exit') };
  const keep = (chunk) => {
    handle.output = (handle.output + chunk).slice(-65536);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  handle.stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await handle.ended;
    }
  };
  t.after(() => handle.stop());
  return handle;
}

async function until(condition, what, handle, ms = 60_000) {
  const deadline = performance.now() + ms;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (performance.now() > deadline)
      throw new Error(`Timed out waiting for ${what}\n${handle?.output.slice(-4000) ?? ''}`);
    await delay(150);
  }
}

test('the production worker delivers publications, restarts without repeating one, and logs no secret or address', async (t) => {
  const f = await setup(t);
  const r = await receiver(t, () => 204);
  const paths = await files(t, f, (p) => ({
    webhooks: [
      {
        id: 'ci',
        repository: 'releases',
        url: `http://127.0.0.1:${r.port}/hook`,
        secretFile: p.secret,
      },
    ],
  }));
  const states = new PostgresWebhookState(f.catalog.pool);
  let running = worker(t, f, paths);
  // The worker records the head before anything counts as an event of the subscription.
  await until(async () => (await states.load('ci')) !== null, 'the first step', running);

  const first = await publish(f, 'first');
  await until(() => r.requests.length === 1, 'the first delivery', running);
  const event = JSON.parse(r.requests[0].body);
  assert.equal(event.artifactId, first);
  assert.equal(event.action, 'artifact.publish');
  assert.equal(
    verifyWebhook({
      secrets: [secret],
      timestamp: r.requests[0].headers['x-arkvory-timestamp'],
      signature: r.requests[0].headers['x-arkvory-signature'],
      body: r.requests[0].body,
      nowSeconds: Math.floor(Date.now() / 1000),
    }),
    true,
  );

  // The worker dies; an event happens meanwhile; the restarted worker delivers it exactly once.
  await running.stop();
  const second = await publish(f, 'second');
  running = worker(t, f, paths);
  await until(() => r.requests.length === 2, 'the delivery after a restart', running);
  await delay(1500);
  assert.equal(r.requests.length, 2, 'nothing is delivered twice');
  assert.deepEqual(
    r.requests.map((request) => JSON.parse(request.body).artifactId),
    [first, second],
  );
  assert.match(running.output, /webhook\.started/);
  for (const output of [running.output]) {
    assert.ok(!output.includes(secret), 'the secret never reaches a log line');
    assert.ok(
      !output.includes(`127.0.0.1:${r.port}`),
      'the receiver address never reaches a log line',
    );
  }
});

test('a receiver that is down shows as a constant error code in the log and is retried', async (t) => {
  const f = await setup(t);
  let answer = 500;
  const r = await receiver(t, () => answer);
  const paths = await files(t, f, (p) => ({
    webhooks: [
      {
        id: 'ci',
        repository: 'releases',
        url: `http://127.0.0.1:${r.port}/hook`,
        secretFile: p.secret,
      },
    ],
  }));
  const states = new PostgresWebhookState(f.catalog.pool);
  const running = worker(t, f, paths);
  await until(async () => (await states.load('ci')) !== null, 'the first step', running);
  await publish(f, 'event');
  await until(() => /webhook\.step_failed/.test(running.output), 'a logged failure', running);
  assert.match(running.output, /"errorCode":"http_5xx"/);
  const failing = await states.load('ci');
  assert.equal(failing.cursor, '0', 'the failed event is not passed over');
  assert.ok(failing.failures >= 1);
  assert.ok(r.requests.length >= 1);
  // The receiver recovers: the same event arrives and the failure clears.
  answer = 204;
  await until(
    async () => (await states.load('ci')).errorCode === null,
    'recovery',
    running,
    120_000,
  );
  assert.equal((await states.load('ci')).deliveredCount, 1);
});

test('an invalid webhooks file stops the worker at startup with a constant message', async (t) => {
  const f = await setup(t);
  const paths = await files(t, f, (p) => ({
    webhooks: [
      { id: 'Bad Id', repository: 'releases', url: 'http://ci.example/hook', secretFile: p.secret },
    ],
  }));
  const running = worker(t, f, paths);
  const [code] = await running.ended;
  assert.equal(code, 1);
  assert.match(running.output, /worker\.unavailable/);
  assert.ok(!running.output.includes('ci.example'), 'the URL is not echoed');
  assert.ok(!running.output.includes(secret));
});

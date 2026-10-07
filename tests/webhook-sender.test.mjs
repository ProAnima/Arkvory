import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { WebhookFailure } from '@proanima/arkvory-application';
import {
  HttpWebhookSender,
  createEgressPolicy,
  verifyWebhook,
} from '@proanima/arkvory-infrastructure';
import { selfSignedCertificate } from './tls-certificate.mjs';

const live = { throwIfAborted() {} };
const secret = 'a-long-random-signing-secret-1';
const next = 'the-next-signing-secret-2026';
const event = {
  id: 'releases:42',
  repository: 'releases',
  sequence: '42',
  action: 'artifact.publish',
  artifactId: '00000000-0000-4000-8000-000000000001',
  detail: null,
};
const open = createEgressPolicy([]);
const toLoopback = async () => [{ address: '127.0.0.1', family: 4 }];

/** A receiver that records every request and answers by a script. */
async function receiver(t, answer = () => ({ status: 204 }), secure) {
  const requests = [];
  const handler = (request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const reply = answer(requests.length);
      if (reply.hang) return;
      response.writeHead(reply.status, reply.headers ?? {});
      response.end(reply.body ?? '');
    });
  };
  const server = secure ? createSecureServer(secure, handler) : createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { requests, port: server.address().port };
}

function sender(url, options = {}) {
  return new HttpWebhookSender({
    url,
    policy: open,
    secrets: async () => [secret],
    nowSeconds: () => 1_790_000_000,
    ...options,
  });
}

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WebhookFailure, String(error));
    return error.code;
  }
  return 'delivered';
}

test('the event is posted as JSON with a delivery id, a timestamp and a signature the receiver can verify', async (t) => {
  const r = await receiver(t);
  await sender(`http://127.0.0.1:${r.port}/hooks/arkvory`).send(event, live);
  assert.equal(r.requests.length, 1);
  const [call] = r.requests;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, '/hooks/arkvory');
  assert.equal(call.headers['content-type'], 'application/json');
  assert.equal(call.headers['user-agent'], 'Arkvory-Webhook/1');
  assert.equal(call.headers['x-arkvory-delivery'], 'releases:42');
  assert.equal(call.headers['x-arkvory-event'], 'artifact.publish');
  assert.equal(call.headers['x-arkvory-timestamp'], '1790000000');
  assert.deepEqual(JSON.parse(call.body), event);
  assert.equal(
    verifyWebhook({
      secrets: [secret],
      timestamp: call.headers['x-arkvory-timestamp'],
      signature: call.headers['x-arkvory-signature'],
      body: call.body,
      nowSeconds: 1_790_000_005,
    }),
    true,
  );
});

test('during a rotation the delivery carries a signature of each secret', async (t) => {
  const r = await receiver(t);
  await sender(`http://127.0.0.1:${r.port}/`, { secrets: async () => [secret, next] }).send(
    event,
    live,
  );
  const header = r.requests[0].headers['x-arkvory-signature'];
  assert.equal(header.split(',').length, 2);
  for (const accepted of [secret, next])
    assert.equal(
      verifyWebhook({
        secrets: [accepted],
        timestamp: r.requests[0].headers['x-arkvory-timestamp'],
        signature: header,
        body: r.requests[0].body,
        nowSeconds: 1_790_000_000,
      }),
      true,
    );
});

test('status codes map to constant failure codes and redirects are never followed', async (t) => {
  const cases = [
    [{ status: 200 }, 'delivered'],
    [{ status: 202 }, 'delivered'],
    [{ status: 302, headers: { location: '/elsewhere' } }, 'redirect'],
    [{ status: 308, headers: { location: 'http://169.254.169.254/' } }, 'redirect'],
    [{ status: 404 }, 'http_4xx'],
    [{ status: 429 }, 'http_4xx'],
    [{ status: 500 }, 'http_5xx'],
    [{ status: 503 }, 'http_5xx'],
  ];
  for (const [reply, expected] of cases) {
    const r = await receiver(t, () => reply);
    const code = await failureOf(sender(`http://127.0.0.1:${r.port}/`).send(event, live));
    assert.equal(code, expected, String(reply.status));
    assert.equal(r.requests.length, 1, `status ${reply.status} must not trigger a second request`);
  }
});

test('a slow receiver ends as a timeout, and a closed port as a network failure', async (t) => {
  const hang = await receiver(t, () => ({ hang: true }));
  const started = Date.now();
  assert.equal(
    await failureOf(sender(`http://127.0.0.1:${hang.port}/`, { timeoutMs: 300 }).send(event, live)),
    'timeout',
  );
  assert.ok(Date.now() - started < 3000);
  const closed = await receiver(t);
  const port = closed.port;
  // A port nothing listens on any more.
  const dead = createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  assert.notEqual(deadPort, port);
  assert.equal(
    await failureOf(sender(`http://127.0.0.1:${deadPort}/`).send(event, live)),
    'network',
  );
});

test('name resolution counts against the same 10 s budget as the request', async (t) => {
  const r = await receiver(t, () => ({ hang: true }));
  const policy = createEgressPolicy(['127.0.0.0/8']);
  // The lookup alone outlives the budget: the delivery ends without connecting.
  const never = () => new Promise(() => undefined);
  let started = performance.now();
  assert.equal(
    await failureOf(
      sender(`http://hooks.invalid:${r.port}/`, { policy, resolve: never, timeoutMs: 200 }).send(
        event,
        live,
      ),
    ),
    'timeout',
  );
  assert.ok(performance.now() - started < 2000);
  assert.equal(r.requests.length, 0);
  // A slow lookup leaves the request only the rest of the budget, not a fresh one.
  const slow = () =>
    new Promise((resolve) => setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 400));
  started = performance.now();
  assert.equal(
    await failureOf(
      sender(`http://hooks.invalid:${r.port}/`, { policy, resolve: slow, timeoutMs: 600 }).send(
        event,
        live,
      ),
    ),
    'timeout',
  );
  const elapsed = performance.now() - started;
  // A fresh budget after the lookup would end at about 1000 ms.
  assert.ok(elapsed < 900, `whole delivery bounded by its budget, took ${String(elapsed)} ms`);
});

test('a response body is read for at most 4 KiB and never changes the outcome', async (t) => {
  const r = await receiver(t, () => ({ status: 200, body: 'x'.repeat(5 * 1024 * 1024) }));
  await sender(`http://127.0.0.1:${r.port}/`).send(event, live);
  const failing = await receiver(t, () => ({ status: 500, body: 'y'.repeat(1024 * 1024) }));
  assert.equal(
    await failureOf(sender(`http://127.0.0.1:${failing.port}/`).send(event, live)),
    'http_5xx',
  );
});

test('a blocked receiver is refused before any connection is made', async (t) => {
  const r = await receiver(t);
  // The name resolves to the machine itself, which the default policy does not allow over HTTPS.
  const code = await failureOf(
    sender(`https://hooks.example:${r.port}/`, { resolve: toLoopback }).send(event, live),
  );
  assert.equal(code, 'blocked');
  assert.equal(r.requests.length, 0);
  for (const address of ['169.254.169.254', '10.0.0.7', '192.168.0.9']) {
    const blocked = await failureOf(
      sender('https://hooks.example/', { resolve: async () => [{ address, family: 4 }] }).send(
        event,
        live,
      ),
    );
    assert.equal(blocked, 'blocked', address);
  }
});

test('the connection goes to the address that was checked, not to a name looked up again', async (t) => {
  const r = await receiver(t);
  // The operator allowed 127.0.0.0/8. The URL names a host that does not exist in DNS: only the
  // injected, checked answer can have been used.
  const policy = createEgressPolicy(['127.0.0.0/8']);
  await sender(`http://receiver.invalid:${r.port}/hook`, { policy, resolve: toLoopback }).send(
    event,
    live,
  );
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].headers.host, `receiver.invalid:${r.port}`);
});

test('HTTPS verifies the receiver certificate; a private authority is trusted only when given', async (t) => {
  const material = selfSignedCertificate();
  const r = await receiver(t, () => ({ status: 204 }), { cert: material.cert, key: material.key });
  const policy = createEgressPolicy(['127.0.0.0/8']);
  const url = `https://localhost:${r.port}/hook`;
  assert.equal(
    await failureOf(sender(url, { policy, resolve: toLoopback }).send(event, live)),
    'tls',
    'an unknown authority is not trusted',
  );
  await sender(url, { policy, resolve: toLoopback, ca: [material.cert] }).send(event, live);
  assert.equal(r.requests.length, 1);
});

test('a secret that cannot be read stops the delivery before anything is sent', async (t) => {
  const r = await receiver(t);
  const code = await failureOf(
    sender(`http://127.0.0.1:${r.port}/`, {
      secrets: async () => {
        throw new WebhookFailure('secret');
      },
    }).send(event, live),
  );
  assert.equal(code, 'secret');
  assert.equal(r.requests.length, 0);
});

test('a cancelled step sends nothing', async (t) => {
  const r = await receiver(t);
  const stopped = {
    throwIfAborted() {
      throw new Error('aborted');
    },
  };
  await assert.rejects(sender(`http://127.0.0.1:${r.port}/`).send(event, stopped), /aborted/);
  assert.equal(r.requests.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localRequest, localTarget } from '../apps/deploy/dist/local-api.js';
import { selfSignedCertificate } from './tls-certificate.mjs';

async function listening(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return String(server.address().port);
}

async function certificateFile(t, pem) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-local-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'fullchain.pem');
  await writeFile(path, pem);
  return path;
}

const reply = (request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ path: request.url, auth: request.headers.authorization ?? null }));
};

test('local targets follow the installation transport and refuse TLS with Compose', () => {
  assert.deepEqual(localTarget({ ARKVORY_HOST: '0.0.0.0', ARKVORY_PORT: '9443' }), {
    host: '127.0.0.1',
    port: '9443',
  });
  assert.deepEqual(localTarget({ ARKVORY_TLS_CERT_FILE: '/etc/arkvory/fullchain.pem' }), {
    host: '127.0.0.1',
    port: '8080',
    certificateFile: '/etc/arkvory/fullchain.pem',
  });
  assert.throws(() => localTarget({ ARKVORY_PORT: '80a' }), /Invalid API port/);
  assert.throws(
    () => localTarget({ ARKVORY_TLS_CERT_FILE: '/etc/arkvory/fullchain.pem' }, true),
    /reverse proxy with Compose/,
  );
});

test('tooling reaches a plain-HTTP API and keeps headers and body bounded', async (t) => {
  const port = await listening(t, createHttp(reply));
  const response = await localRequest({ host: '127.0.0.1', port }, '/health/ready', {
    headers: { Authorization: 'Bearer test' },
    timeoutMs: 3000,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { path: '/health/ready', auth: 'Bearer test' });
  await assert.rejects(
    localRequest({ host: '127.0.0.1', port }, 'http://elsewhere/', { timeoutMs: 1000 }),
    /Invalid local API path/,
  );
});

test('with built-in TLS the configured certificate is required, not just any valid one', async (t) => {
  const served = selfSignedCertificate();
  const port = await listening(t, createHttps({ key: served.key, cert: served.cert }, reply));
  const configured = await certificateFile(t, served.cert);
  const response = await localRequest(
    { host: '127.0.0.1', port, certificateFile: configured },
    '/health/ready',
    { timeoutMs: 3000 },
  );
  assert.equal(response.status, 200);
  // A different certificate, even a valid self-signed one, is rejected.
  const other = await certificateFile(t, selfSignedCertificate().cert);
  await assert.rejects(
    localRequest({ host: '127.0.0.1', port, certificateFile: other }, '/health/ready', {
      timeoutMs: 3000,
    }),
  );
  // Plain HTTP to the HTTPS listener fails instead of silently succeeding.
  await assert.rejects(
    localRequest({ host: '127.0.0.1', port }, '/health/ready', { timeoutMs: 3000 }),
  );
});

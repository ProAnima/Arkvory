import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../apps/api/dist/http-server.js';
import { readTls, plaintextExposed } from '../apps/api/dist/tls-config.js';
import { loadTlsMaterial, TlsCertificateWatcher } from '../apps/api/dist/tls-material.js';
import { prepareTls } from '../apps/api/dist/tls-transport.js';
import { selfSignedCertificate } from './tls-certificate.mjs';

const day = 24 * 60 * 60 * 1000;

async function files(t, material) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificateFile = join(directory, 'cert.pem');
  const keyFile = join(directory, 'key.pem');
  await writeFile(certificateFile, material.cert);
  await writeFile(keyFile, material.key);
  return { certificateFile, keyFile, minVersion: 'TLSv1.2', reloadSeconds: 300 };
}

function get(port, ca) {
  return new Promise((resolve, reject) => {
    const call = request(
      { host: '127.0.0.1', port, path: '/ping', servername: 'localhost', ca, agent: false },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            hsts: response.headers['strict-transport-security'],
            fingerprint: response.socket.getPeerCertificate().fingerprint256,
          });
        });
      },
    );
    call.on('error', reject);
    call.end();
  });
}

test('TLS settings require both files and bounded options', () => {
  assert.deepEqual(readTls({}), {});
  assert.throws(() => readTls({ ARKVORY_TLS_CERT_FILE: 'cert.pem' }), /set together/);
  assert.throws(
    () =>
      readTls({
        ARKVORY_TLS_CERT_FILE: 'c',
        ARKVORY_TLS_KEY_FILE: 'k',
        ARKVORY_TLS_MIN_VERSION: 'TLSv1',
      }),
    /TLSv1\.2 or TLSv1\.3/,
  );
  for (const value of ['5', '-1', '90000', 'soon'])
    assert.throws(
      () =>
        readTls({
          ARKVORY_TLS_CERT_FILE: 'c',
          ARKVORY_TLS_KEY_FILE: 'k',
          ARKVORY_TLS_RELOAD_SECONDS: value,
        }),
      /0 or 30-86400/,
    );
  assert.deepEqual(readTls({ ARKVORY_TLS_CERT_FILE: 'c', ARKVORY_TLS_KEY_FILE: 'k' }).tls, {
    certificateFile: 'c',
    keyFile: 'k',
    minVersion: 'TLSv1.2',
    reloadSeconds: 300,
  });
  assert.equal(plaintextExposed('0.0.0.0', false, []), true);
  assert.equal(plaintextExposed('0.0.0.0', true, []), false);
  assert.equal(plaintextExposed('0.0.0.0', false, ['10.0.0.5']), false);
  assert.equal(plaintextExposed('127.0.0.1', false, []), false);
});

test('certificate material is rejected when mismatched, expired or not PEM', async (t) => {
  const first = selfSignedCertificate();
  const second = selfSignedCertificate();
  const mismatched = await files(t, { cert: first.cert, key: second.key });
  await assert.rejects(loadTlsMaterial(mismatched, Date.now), /do not match/);
  const expired = await files(
    t,
    selfSignedCertificate({ notBefore: new Date(Date.now() - 3 * day), days: 1 }),
  );
  await assert.rejects(loadTlsMaterial(expired, Date.now), /expired/);
  const garbage = await files(t, { cert: 'not a certificate', key: first.key });
  await assert.rejects(loadTlsMaterial(garbage, Date.now), /not valid PEM/);
  const valid = await loadTlsMaterial(await files(t, first), Date.now);
  assert.ok(valid.notAfterMs > Date.now());
});

test('built-in HTTPS serves, sends HSTS and reloads a renewed certificate in place', async (t) => {
  const first = selfSignedCertificate();
  const settings = await files(t, first);
  const prepared = await prepareTls({ tls: settings });
  const app = createHttpServer({ trustedProxies: [], ...prepared.options });
  const logs = [];
  const watcher = prepared.attach(app, { write: (record) => logs.push(record) });
  app.get('/ping', async () => ({ ok: true }));
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address();
  const before = await get(port, first.cert);
  assert.equal(before.status, 200);
  assert.equal(before.hsts, 'max-age=31536000');
  // Renewal: new files are picked up without restart; new connections see the new certificate.
  const renewed = selfSignedCertificate();
  await writeFile(settings.certificateFile, renewed.cert);
  await writeFile(settings.keyFile, renewed.key);
  let secure;
  const probe = createHttpServer({
    trustedProxies: [],
    ...prepared.options,
    onSecureServer: (server) => (secure = server),
  });
  await probe.close();
  assert.ok(secure, 'the factory hands out the HTTPS listener');
  await watcher.check({ setSecureContext: (options) => app.server.setSecureContext(options) });
  assert.equal(logs.at(-1).code, 'tls.reloaded');
  const after = await get(port, renewed.cert);
  assert.notEqual(after.fingerprint, before.fingerprint);
  // A broken renewal keeps serving the working certificate and logs a constant reason.
  await writeFile(settings.certificateFile, 'broken');
  await watcher.check({ setSecureContext: (options) => app.server.setSecureContext(options) });
  assert.deepEqual(
    [logs.at(-1).code, logs.at(-1).reason],
    ['tls.reload_failed', 'TLS certificate is not valid PEM'],
  );
  assert.equal((await get(port, renewed.cert)).fingerprint, after.fingerprint);
});

test('expiring certificates are reported once per day', async (t) => {
  const soon = selfSignedCertificate({ days: 5 });
  const settings = await files(t, soon);
  let now = Date.now();
  const material = await loadTlsMaterial(settings, () => now);
  const logs = [];
  const watcher = new TlsCertificateWatcher(
    { ...settings, reloadSeconds: 0 },
    material,
    (record) => logs.push(record),
    () => now,
  );
  watcher.start({ setSecureContext() {} });
  watcher.start({ setSecureContext() {} });
  assert.deepEqual(
    logs.map((record) => record.code),
    ['tls.expiring'],
  );
  assert.ok(logs[0].daysLeft <= 5);
  now += day + 1;
  watcher.start({ setSecureContext() {} });
  assert.equal(logs.length, 2);
  watcher.stop();
});

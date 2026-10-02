import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureTls, validateTlsFiles } from '../apps/deploy/dist/tls-setup.js';
import { selfSignedCertificate } from './tls-certificate.mjs';

const release = { version: '1.0.0', commit: 'c', schema: 25, archiveSha256: 'a', setupSha256: 's' };
const day = 24 * 60 * 60 * 1000;

async function installation(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-tls-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'config'));
  const runtime = { ARKVORY_HOST: '127.0.0.1', ARKVORY_PORT: '8080', ARKVORY_DATA_DIR: '/data' };
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify(runtime));
  const certificate = selfSignedCertificate();
  const cert = join(root, 'fullchain.pem');
  const key = join(root, 'privkey.pem');
  await writeFile(cert, certificate.cert);
  await writeFile(key, certificate.key);
  return { root, cert, key, certificate };
}

function services(healthy = () => undefined) {
  const calls = [];
  return {
    calls,
    stop: async () => calls.push('stop'),
    start: async (current) => calls.push(`start ${current.version}`),
    healthy: async () => {
      calls.push('healthy');
      await healthy(calls);
    },
  };
}

const runtimeOf = async (root) =>
  JSON.parse(await readFile(join(root, 'config/runtime.json'), 'utf8'));

test('enabling HTTPS writes the referenced files, restarts and requires readiness', async (t) => {
  const { root, cert, key, certificate } = await installation(t);
  const control = services();
  const state = { mode: 'systemd', current: release };
  const expires = await configureTls(
    root,
    state,
    { certificateFile: cert, keyFile: key, host: '0.0.0.0' },
    control,
  );
  assert.equal(expires.getTime(), Math.floor(certificate.notAfter.getTime() / 1000) * 1000);
  const runtime = await runtimeOf(root);
  assert.equal(runtime.ARKVORY_TLS_CERT_FILE, cert);
  assert.equal(runtime.ARKVORY_TLS_KEY_FILE, key);
  assert.equal(runtime.ARKVORY_HOST, '0.0.0.0');
  assert.equal(runtime.ARKVORY_DATA_DIR, '/data', 'other settings are preserved');
  assert.deepEqual(control.calls, ['stop', 'start 1.0.0', 'healthy']);
  // Turning it off removes only the TLS settings.
  await configureTls(root, state, { disable: true }, services());
  const plain = await runtimeOf(root);
  assert.equal(plain.ARKVORY_TLS_CERT_FILE, undefined);
  assert.equal(plain.ARKVORY_HOST, '0.0.0.0');
});

test('a failed restart restores the previous configuration and reports it', async (t) => {
  const { root, cert, key } = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  let first = true;
  const control = services(() => {
    if (first) {
      first = false;
      throw new Error('readiness failed');
    }
  });
  await assert.rejects(
    configureTls(
      root,
      { mode: 'windows', current: release },
      { certificateFile: cert, keyFile: key },
      control,
    ),
    /previous configuration is restored \(readiness failed\)/,
  );
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
  assert.deepEqual(control.calls, [
    'stop',
    'start 1.0.0',
    'healthy',
    'stop',
    'start 1.0.0',
    'healthy',
  ]);
});

test('wrong files are refused before anything changes', async (t) => {
  const { root, cert, key } = await installation(t);
  const before = await readFile(join(root, 'config/runtime.json'), 'utf8');
  const other = join(root, 'other.pem');
  await writeFile(other, selfSignedCertificate().key);
  const state = { mode: 'systemd', current: release };
  await assert.rejects(
    configureTls(root, state, { certificateFile: cert, keyFile: other }, services()),
    /do not match/,
  );
  await assert.rejects(
    configureTls(root, state, { certificateFile: 'cert.pem', keyFile: key }, services()),
    /absolute paths/,
  );
  await assert.rejects(
    configureTls(root, state, { certificateFile: cert }, services()),
    /--tls-cert and --tls-key together/,
  );
  await assert.rejects(
    configureTls(
      root,
      { mode: 'compose', current: release },
      { certificateFile: cert, keyFile: key },
      services(),
    ),
    /reverse proxy with Compose/,
  );
  await assert.rejects(validateTlsFiles(cert, key, Date.now() + 365 * day), /expired/);
  assert.equal(await readFile(join(root, 'config/runtime.json'), 'utf8'), before);
});

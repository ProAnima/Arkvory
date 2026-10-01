import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './fixture.mjs';
import { selfSignedCertificate } from '../tls-certificate.mjs';

async function tlsFiles(t, material) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-tls-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificateFile = join(directory, 'fullchain.pem');
  const keyFile = join(directory, 'privkey.pem');
  await writeFile(certificateFile, material.cert);
  await writeFile(keyFile, material.key);
  return { certificateFile, keyFile, minVersion: 'TLSv1.2', reloadSeconds: 0 };
}

function get(origin, path, headers, ca) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, origin);
    const call = request(
      url,
      { headers, ca, servername: 'localhost', agent: false },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body }),
        );
      },
    );
    call.on('error', reject);
    call.end();
  });
}

test('the complete API serves HTTPS with HSTS and reports the certificate expiry', async (t) => {
  const certificate = selfSignedCertificate();
  const f = await setup(t, { tls: await tlsFiles(t, certificate) });
  // Fastify names the scheme from its own `https` option; the factory-made listener is TLS.
  const origin = (await f.listen()).replace(/^http:/, 'https:');
  const me = await get(origin, '/api/v1/auth/me', f.headers, certificate.cert);
  assert.equal(me.status, 200, me.body);
  assert.equal(me.headers['strict-transport-security'], 'max-age=31536000');
  const metrics = await get(origin, '/health/metrics', f.headers, certificate.cert);
  assert.equal(metrics.status, 200);
  const expiry = Math.floor(certificate.notAfter.getTime() / 1000);
  assert.match(
    metrics.body,
    new RegExp(`^arkvory_tls_certificate_expiry_timestamp_seconds ${String(expiry)}$`, 'm'),
  );
  // Plain HTTP to the TLS port is not answered as an API request.
  await assert.rejects(fetch(origin.replace('https:', 'http:') + '/health/live'));
});

test('a mismatched key stops startup instead of falling back to HTTP', async (t) => {
  const certificate = selfSignedCertificate();
  const other = selfSignedCertificate();
  await assert.rejects(
    setup(t, { tls: await tlsFiles(t, { cert: certificate.cert, key: other.key }) }),
    /do not match/,
  );
});

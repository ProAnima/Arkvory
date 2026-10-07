import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePlaintextExposed } from '../packages/infrastructure/dist/index.js';

const remote = 'postgresql://arkvory:secret@db.example.com:5432/arkvory';
const none = {};
const exposed = (url, environment = none) => databasePlaintextExposed(url, environment);

test('a remote database without TLS settings is reported as plain text', () => {
  assert.equal(exposed(remote), true);
  assert.equal(exposed(`${remote}?sslmode=disable`), true);
  assert.equal(exposed(`${remote}?ssl=false`), true);
  assert.equal(exposed(`${remote}?ssl=0`), true);
  assert.equal(exposed(`${remote}?sslmode=`), true, 'an empty value is absent, as in pg');
});

test('every sslmode except disable, and ssl=true, turn TLS on as pg does', () => {
  for (const mode of ['allow', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'])
    assert.equal(exposed(`${remote}?sslmode=${mode}`), false, mode);
  assert.equal(exposed(`${remote}?ssl=true`), false);
  assert.equal(exposed(`${remote}?ssl=1`), false);
});

test('certificate files and direct TLS negotiation turn TLS on without sslmode', () => {
  for (const parameter of ['sslrootcert=/etc/ca.pem', 'sslcert=/etc/c.pem', 'sslkey=/etc/k.pem'])
    assert.equal(exposed(`${remote}?${parameter}`), false, parameter);
  // pg: a file overrides ssl=0, sslmode=disable overrides a file.
  assert.equal(exposed(`${remote}?ssl=0&sslrootcert=/etc/ca.pem`), false);
  assert.equal(exposed(`${remote}?sslmode=disable&sslrootcert=/etc/ca.pem`), true);
  assert.equal(exposed(`${remote}?sslnegotiation=direct`), false);
  assert.equal(exposed(`${remote}?ssl=false&sslnegotiation=direct`), true, 'ssl=false wins');
});

test('PGSSLMODE applies only when the URL names no TLS setting', () => {
  assert.equal(exposed(remote, { PGSSLMODE: 'require' }), false);
  assert.equal(exposed(remote, { PGSSLMODE: 'verify-full' }), false);
  assert.equal(exposed(remote, { PGSSLMODE: 'disable' }), true);
  assert.equal(exposed(remote, { PGSSLMODE: 'allow' }), true, 'pg ignores allow from the env');
  assert.equal(exposed(`${remote}?sslmode=disable`, { PGSSLMODE: 'require' }), true);
  assert.equal(exposed(`${remote}?ssl=false`, { PGSSLMODE: 'require' }), true);
});

test('loopback, Unix sockets and host lists never leave the machine or are not judged', () => {
  for (const url of [
    'postgresql://u:p@127.0.0.1:55432/arkvory',
    'postgresql://u:p@localhost/arkvory',
    'postgresql://u:p@[::1]:5432/arkvory',
    'postgresql://u:p@/arkvory?host=/var/run/postgresql',
    'postgresql://u:p@a.example,b.example/arkvory',
  ])
    assert.equal(exposed(url), false, url);
});

test('only the bundled Compose database as init writes it stays on the host', () => {
  assert.equal(exposed('postgresql://arkvory:0123abcd@database:5432/arkvory'), false);
  for (const url of [
    'postgresql://arkvory:p@db:5432/arkvory',
    'postgresql://arkvory:p@database:5433/arkvory',
    'postgresql://other:p@database:5432/arkvory',
    'postgresql://arkvory:p@database:5432/other',
    'postgresql://arkvory:p@database.example.com:5432/arkvory',
    'postgresql://arkvory:p@database:5432/arkvory?host=db.example.com',
  ])
    assert.equal(exposed(url), true, url);
});

test('an unparsable value is not judged and the secret is never part of the verdict', () => {
  assert.equal(exposed('not a url'), false);
  assert.equal(typeof exposed(remote), 'boolean');
});

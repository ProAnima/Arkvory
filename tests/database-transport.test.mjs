import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePlaintextExposed } from '../packages/infrastructure/dist/index.js';

const remote = 'postgresql://arkvory:secret@db.example.com:5432/arkvory';

test('a remote database without TLS settings is reported as plain text', () => {
  assert.equal(databasePlaintextExposed(remote), true);
  assert.equal(databasePlaintextExposed(`${remote}?sslmode=disable`), true);
  assert.equal(databasePlaintextExposed(`${remote}?sslmode=allow`), true);
  assert.equal(databasePlaintextExposed(`${remote}?ssl=false`), true);
});

test('every verifying sslmode or ssl=true counts as protected', () => {
  for (const mode of ['require', 'verify-ca', 'verify-full', 'prefer', 'no-verify'])
    assert.equal(databasePlaintextExposed(`${remote}?sslmode=${mode}`), false, mode);
  assert.equal(databasePlaintextExposed(`${remote}?ssl=true`), false);
  assert.equal(databasePlaintextExposed(`${remote}?ssl=1`), false);
});

test('loopback, Unix sockets and host lists never leave the machine or are not judged', () => {
  for (const url of [
    'postgresql://u:p@127.0.0.1:55432/arkvory',
    'postgresql://u:p@localhost/arkvory',
    'postgresql://u:p@[::1]:5432/arkvory',
    'postgresql://u:p@/arkvory?host=/var/run/postgresql',
    'postgresql://u:p@a.example,b.example/arkvory',
  ])
    assert.equal(databasePlaintextExposed(url), false, url);
});

test('an unparsable value is not judged and the secret is never part of the verdict', () => {
  assert.equal(databasePlaintextExposed('not a url'), false);
  assert.equal(typeof databasePlaintextExposed(remote), 'boolean');
});

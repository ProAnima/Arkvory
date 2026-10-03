import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signRelease, verifyReleaseSignature } from '../apps/deploy/dist/release-signature.js';
import { releaseKeys } from '../apps/deploy/dist/release-keys.js';
import { signDirectory } from '../scripts/release-signing.mjs';
import { removeTestDirectory } from './helpers.mjs';
import { testKey } from './release-test-key.mjs';

test('a signature verifies only for the same bytes, comment and a built-in key', () => {
  const key = testKey();
  const bytes = Buffer.from('{"version":"1.2.3"}');
  const signature = signRelease(bytes, key.pem, key.id, 'timestamp:1\tfile:arkvory-release.json');
  verifyReleaseSignature(bytes, signature, key.trusted);
  assert.throws(
    () => verifyReleaseSignature(Buffer.from('{"version":"1.2.4"}'), signature, key.trusted),
    /not valid/,
  );
  const comment = signature.replace('file:arkvory-release.json', 'file:other.json');
  assert.throws(() => verifyReleaseSignature(bytes, comment, key.trusted), /not valid/);
  assert.throws(() => verifyReleaseSignature(bytes, signature, testKey().trusted), /unknown key/);
  // Another key presenting this key's id is still rejected by the signature itself.
  const impostor = testKey();
  const forged = signRelease(bytes, impostor.pem, key.id, 'timestamp:1');
  assert.throws(() => verifyReleaseSignature(bytes, forged, key.trusted), /not valid/);
  for (const broken of ['', 'untrusted comment: x\nAAAA\ntrusted comment: y\nAAAA'])
    assert.throws(() => verifyReleaseSignature(bytes, broken, key.trusted), /Invalid/);
});

test('the built-in keys are well formed', () => {
  assert.ok(releaseKeys.length >= 1);
  for (const key of releaseKeys) {
    assert.match(key.id, /^[0-9a-f]{16}$/);
    assert.equal(Buffer.from(key.publicKey, 'base64').length, 32);
  }
  assert.equal(new Set(releaseKeys.map((key) => key.id)).size, releaseKeys.length);
});

test('a signed release folder carries the signature and the hub manifest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-signing-'));
  t.after(() => removeTestDirectory(directory));
  const key = testKey();
  const keyFile = join(directory, 'key.json');
  await writeFile(keyFile, JSON.stringify({ format: 1, id: key.id, privateKey: key.pem }));
  const manifest = Buffer.from(JSON.stringify({ version: '1.2.3', schema: 28 }));
  await writeFile(join(directory, 'arkvory-release.json'), manifest);
  await signDirectory(directory, keyFile, key.trusted);
  const signature = await readFile(join(directory, 'arkvory-release.json.sig'), 'utf8');
  verifyReleaseSignature(manifest, signature, key.trusted);
  const latest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
  assert.equal(latest.version, '1.2.3');
  assert.deepEqual(Object.keys(latest.platforms).sort(), ['linux-x86_64', 'windows-x86_64']);
  for (const platform of Object.values(latest.platforms)) {
    assert.equal(
      platform.url,
      'https://github.com/ProAnima/Arkvory/releases/download/v1.2.3/arkvory-release.json',
    );
    // Tauri's format: the base64 of the minisign signature file.
    assert.equal(Buffer.from(platform.signature, 'base64').toString(), signature);
  }
  // A key unknown to the released updaters must never produce a release.
  await assert.rejects(signDirectory(directory, keyFile), /unknown key/);
});

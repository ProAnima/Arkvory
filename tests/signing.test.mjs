import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { MODULE_ID_PATTERN } from '../packages/extension-api/dist/index.js';
import {
  OPERATOR_ID_PATTERN,
  acceptRevocations,
  keyFingerprint,
  keyRing,
  licenseKeys,
  minisignPublicKeyText,
  moduleKeys,
  newerRevocations,
  operatorKeyExpired,
  parseMinisignPublicKey,
  parsePluginTrust,
  pluginPatternCovers,
  readRevocations,
  revocationOf,
  verifyClassified,
  verifyMinisign,
} from '../packages/signing/dist/index.js';
import { releaseKeys } from '../apps/deploy/dist/release-keys.js';
import { operatorEntry, revocationList, sign, testHost, testKey } from './module-fixtures.mjs';

const code = (expected) => (error) => error?.code === expected;

test('a minisign signature verifies only the signed bytes, comment and key', () => {
  const key = testKey();
  const bytes = Buffer.from('{"id":"sample"}');
  const signature = sign(bytes, key);
  assert.equal(verifyMinisign(bytes, signature, [key.key]).keyId, key.id);
  assert.throws(
    () => verifyMinisign(Buffer.from('{"id":"other"}'), signature, [key.key]),
    code('signature_invalid'),
  );
  const comment = signature.replace('file:module.json', 'file:other.json');
  assert.throws(() => verifyMinisign(bytes, comment, [key.key]), code('signature_invalid'));
  assert.throws(() => verifyMinisign(bytes, signature, [testKey().key]), code('unknown_key'));
  for (const broken of [
    '',
    'untrusted comment: x\nAAAA\ntrusted comment: y\nAAAA',
    signature.slice(1),
  ])
    assert.throws(() => verifyMinisign(bytes, broken, [key.key]), code('signature_malformed'));
  assert.throws(
    () => verifyMinisign(bytes, signature, [{ id: key.id, publicKey: 'AAAA' }]),
    code('key_invalid'),
  );
});

test('the legacy non-prehashed minisign algorithm still verifies', () => {
  const key = testKey();
  const bytes = Buffer.from('legacy');
  const comment = 'timestamp:1';
  const value = edSign(null, bytes, createPrivateKey(key.pem));
  const global = edSign(
    null,
    Buffer.concat([value, Buffer.from(comment)]),
    createPrivateKey(key.pem),
  );
  const body = Buffer.concat([Buffer.from('Ed'), Buffer.from(key.id, 'hex'), value]);
  const signature = `untrusted comment: x\n${body.toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`;
  assert.equal(verifyMinisign(bytes, signature, [key.key]).trustedComment, comment);
});

test('a minisign public key file round-trips and malformed keys are refused', () => {
  const key = testKey();
  const text = minisignPublicKeyText(key.key, 'minisign public key');
  assert.deepEqual(parseMinisignPublicKey(text), key.key);
  assert.deepEqual(parseMinisignPublicKey(text.split('\n')[1]), key.key);
  for (const broken of ['', 'RWQ', `x\n${text.split('\n')[1]}`, 'a\nb\nc', 'A'.repeat(5000)])
    assert.throws(() => parseMinisignPublicKey(broken), code('key_invalid'));
  assert.match(keyFingerprint(key.key), /^([0-9a-f]{4} ){15}[0-9a-f]{4}$/);
});

test('one key id belongs to one class; a module key never stands for another class', () => {
  const { host, module, release, license, operator } = testHost();
  const bytes = Buffer.from('{}');
  for (const [signer, accepted] of [
    [release, false],
    [license, false],
    [module, true],
    [operator, true],
  ]) {
    const signature = sign(bytes, signer);
    if (accepted)
      verifyClassified(bytes, signature, host.keys, ['module', 'operator'], 'module.json');
    else
      assert.throws(
        () => verifyClassified(bytes, signature, host.keys, ['module', 'operator'], 'module.json'),
        code('wrong_key_class'),
      );
  }
  // The purpose separates what one module key signs.
  assert.throws(
    () =>
      verifyClassified(
        bytes,
        sign(bytes, module, 'module-revocations.json'),
        host.keys,
        ['module'],
        'module.json',
      ),
    code('signature_purpose'),
  );
  assert.throws(
    () => keyRing({ module: [module.key], release: [module.key] }),
    code('duplicate_key'),
  );
  assert.throws(
    () => keyRing({ operator: [operatorEntry(release)], release: [release.key] }),
    code('duplicate_key'),
  );
});

test('the built-in keys are well formed and disjoint from the release keys', () => {
  const ring = keyRing({ release: releaseKeys, module: moduleKeys, license: licenseKeys });
  assert.equal(ring.length, releaseKeys.length + moduleKeys.length + licenseKeys.length);
  // The signing package repeats the id rule of extension-api for plugin ids; both must agree.
  for (const id of ['op-ab', 'op-acme-scan', 'op-a', 'op--x', 'op-x-', 'op-' + 'a'.repeat(22)])
    assert.equal(
      OPERATOR_ID_PATTERN.test(id),
      MODULE_ID_PATTERN.test(id) && /^op-[a-z][a-z0-9-]{1,20}$/.test(id),
      id,
    );
});

test('the operator trust list is read as untrusted input', () => {
  const key = testKey();
  const entry = operatorEntry(key, {
    plugins: ['op-acme-*', 'op-tool'],
    expiresAt: '2026-12-31T00:00:00Z',
  });
  const trust = parsePluginTrust({ format: 1, keys: [entry] });
  assert.deepEqual(trust.keys[0], entry);
  assert.deepEqual(parsePluginTrust({ format: 1, keys: [] }).keys, []);
  const invalid = [
    [{ format: 2, keys: [] }, '/format'],
    [{ format: 1, keys: [], extra: 1 }, '/extra'],
    [{ format: 1, keys: [{ ...entry, extra: true }] }, '/keys/0/extra'],
    [{ format: 1, keys: [{ ...entry, plugins: ['acme-*'] }] }, '/keys/0/plugins/0'],
    [{ format: 1, keys: [{ ...entry, plugins: ['op*'] }] }, '/keys/0/plugins/0'],
    [{ format: 1, keys: [{ ...entry, plugins: [] }] }, '/keys/0/plugins'],
    [{ format: 1, keys: [{ ...entry, publicKey: 'A'.repeat(42) + 'B=' }] }, '/keys/0/publicKey'],
    [{ format: 1, keys: [{ ...entry, label: 'a\nb' }] }, '/keys/0/label'],
    [{ format: 1, keys: [{ ...entry, expiresAt: '2026-13-01T00:00:00Z' }] }, '/keys/0/expiresAt'],
    [{ format: 1, keys: [{ ...entry, allowInProcess: 'yes' }] }, '/keys/0/allowInProcess'],
    [{ format: 1, keys: [entry, entry] }, '/keys/1/keyId'],
  ];
  for (const [input, pointer] of invalid)
    assert.throws(
      () => parsePluginTrust(input),
      (error) => error.code === 'trust_invalid' && error.subject === pointer,
      pointer,
    );
  assert.equal(pluginPatternCovers('op-acme-*', 'op-acme-scan'), true);
  assert.equal(pluginPatternCovers('op-acme-*', 'op-other'), false);
  assert.equal(pluginPatternCovers('op-tool', 'op-tool'), true);
  assert.equal(pluginPatternCovers('op-tool', 'op-tools'), false);
  assert.equal(operatorKeyExpired(trust.keys[0], Date.parse('2026-12-31T00:00:00Z')), true);
  assert.equal(operatorKeyExpired(trust.keys[0], Date.parse('2026-12-30T23:59:59Z')), false);
});

test('a revocation list is signed by a module key and only moves forward', () => {
  const { host, module, release } = testHost();
  const entries = [
    {
      id: 'sample',
      versions: ['1.0.0', '1.0.1'],
      reason: 'read_path_defect',
      readOnly: true,
      replacement: '1.0.2',
    },
  ];
  const first = readRevocations(revocationList(module, { sequence: 5, entries }), host.keys);
  assert.equal(first.sequence, 5);
  assert.equal(first.keyId, module.id);
  assert.deepEqual(revocationOf(first, 'sample', '1.0.1'), entries[0]);
  assert.equal(revocationOf(first, 'sample', '1.0.2'), null);
  assert.equal(revocationOf(null, 'sample', '1.0.0'), null);
  const same = readRevocations(revocationList(module, { sequence: 5, entries }), host.keys);
  const other = readRevocations(revocationList(module, { sequence: 5, entries: [] }), host.keys);
  const older = readRevocations(revocationList(module, { sequence: 4, entries: [] }), host.keys);
  const newer = readRevocations(revocationList(module, { sequence: 6, entries: [] }), host.keys);
  assert.equal(acceptRevocations(null, first), 'accepted');
  assert.equal(acceptRevocations(first, newer), 'accepted');
  assert.equal(acceptRevocations(first, same), 'unchanged');
  assert.throws(() => acceptRevocations(first, older), code('revocation_rollback'));
  assert.throws(() => acceptRevocations(first, other), code('revocation_conflict'));
  assert.equal(newerRevocations(first, older), first);
  assert.equal(newerRevocations(older, newer), newer);
  assert.equal(newerRevocations(null, older), older);
  // Signed by the wrong class, for another purpose, or changed after signing.
  assert.throws(
    () => readRevocations(revocationList(release, { sequence: 9, entries }), host.keys),
    code('wrong_key_class'),
  );
  assert.throws(
    () =>
      readRevocations(revocationList(module, { sequence: 9, entries }, 'module.json'), host.keys),
    code('signature_purpose'),
  );
  const envelope = JSON.parse(revocationList(module, { sequence: 9, entries }));
  const forged = Buffer.from(
    Buffer.from(envelope.payload, 'base64url').toString().replace('"sequence":9', '"sequence":99'),
  );
  assert.throws(
    () =>
      readRevocations(
        JSON.stringify({ ...envelope, payload: forged.toString('base64url') }),
        host.keys,
      ),
    code('signature_invalid'),
  );
});

test('a revocation payload is validated field by field', () => {
  const { host, module } = testHost();
  const entry = {
    id: 'sample',
    versions: ['1.0.0'],
    reason: 'defect',
    readOnly: false,
    replacement: null,
  };
  const cases = [
    [{ sequence: 0, entries: [] }, '/sequence'],
    [{ sequence: 1.5, entries: [] }, '/sequence'],
    [{ sequence: 1, entries: [], extra: 1 }, '/extra'],
    [{ sequence: 1, entries: [{ ...entry, id: 'Bad' }] }, '/entries/0/id'],
    [{ sequence: 1, entries: [{ ...entry, versions: [] }] }, '/entries/0/versions'],
    [{ sequence: 1, entries: [{ ...entry, versions: ['1.0'] }] }, '/entries/0/versions/0'],
    [{ sequence: 1, entries: [{ ...entry, reason: 'Not a code' }] }, '/entries/0/reason'],
    [{ sequence: 1, entries: [{ ...entry, readOnly: 'no' }] }, '/entries/0/readOnly'],
    [{ sequence: 1, entries: [{ ...entry, replacement: 'next' }] }, '/entries/0/replacement'],
    [{ sequence: 1, entries: [], issuedAt: 'yesterday' }, '/issuedAt'],
  ];
  for (const [payload, pointer] of cases)
    assert.throws(
      () => readRevocations(revocationList(module, payload), host.keys),
      (error) => error.code === 'revocations_invalid' && error.subject === pointer,
      pointer,
    );
  for (const envelope of [
    '',
    '[]',
    '{"format":1,"payload":"*","signature":""}',
    'x'.repeat(1024 * 1024 + 1),
  ])
    assert.throws(() => readRevocations(envelope, host.keys), code('revocations_invalid'));
});

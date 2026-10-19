import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  LicenceDocumentError,
  licenceDocumentKind,
  licenceKeyDigest,
  licenceTime,
  normaliseLicenceKey,
  parseLicenceEnvelope,
  strictJson,
  verifyActivationToken,
  verifyLicenceCertificate,
  verifyLicenceRevocationList,
  verifyOfflineActivation,
  verifyRevocationStatement,
} from '../packages/signing/dist/index.js';
import { DAY, iso, licenceAuthority, licenceKeyText, newId, seal } from './licence-fixtures.mjs';

const vectors = new URL('./fixtures/licence-vectors/', import.meta.url);
const vector = async (name) => JSON.parse(await readFile(new URL(name, vectors), 'utf8'));
const refused = (failure, code) => (error) =>
  error instanceof LicenceDocumentError &&
  error.failure === failure &&
  (code === undefined || error.code === code);

async function vectorRoots() {
  const keys = await vector('keys.json');
  return [{ id: keys.root.keyId, publicKey: keys.root.publicKey }];
}

/** The verifier of each kind as the core uses it. */
const verifiers = {
  delegation: (text, roots) => ({
    document: verifyLicenceCertificate(parseLicenceEnvelope(text), roots),
  }),
  activation: verifyActivationToken,
  revocation: verifyRevocationStatement,
  'revocation-list': verifyLicenceRevocationList,
};

test('the copied vectors are the hub files named in their provenance', async () => {
  const provenance = await vector('provenance.json');
  assert.equal(provenance.spec.decided, '2026-10-18');
  assert.match(provenance.main, /^[0-9a-f]{40}$/);
  for (const [name, sha256] of Object.entries(provenance.files)) {
    const bytes = await readFile(new URL(name, vectors));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, name);
  }
});

test('every valid golden vector is accepted with the payload the hub names', async () => {
  const roots = await vectorRoots();
  for (const name of ['01-delegation.json', '02-activation.json', '03-revocation.json']) {
    const v = await vector(name);
    assert.equal(v.valid, true);
    assert.equal(licenceDocumentKind(v.document), v.kind);
    const { document } = verifiers[v.kind](v.document, roots);
    const expected = Object.fromEntries(
      Object.entries(v.payload).filter(([key]) => !['format', 'product'].includes(key)),
    );
    if (v.kind !== 'activation') delete expected.kind;
    assert.deepEqual({ ...document }, expected, name);
  }
  const list = await vector('04-revocation-list.json');
  const verified = verifyLicenceRevocationList(list.document, roots);
  assert.deepEqual(verified.document, {
    number: 1,
    issuedAt: '2026-10-21T00:00:00Z',
    licences: list.payload.licences,
    certificates: [],
  });
  assert.equal(verified.text, list.document, 'the exact text is kept as evidence');
  const token = verifyActivationToken((await vector('02-activation.json')).document, roots);
  assert.equal(token.document.limits['storage.logicalBytes'], '18446744073709551615');
  assert.equal(token.certificate.keyId, '2000000000000002');
});

test('every invalid golden vector is refused with the class the hub names', async () => {
  const roots = await vectorRoots();
  const { cases } = await vector('05-invalid.json');
  assert.equal(cases.length, 7);
  // The class is the hub's; the code shows each case fails for the reason it was made for.
  const codes = [
    'signature_invalid',
    'unknown_key',
    'signature_purpose',
    'payload_invalid',
    'chain_token_days',
    'chain_window',
    'chain_length',
  ];
  cases.forEach((c, index) =>
    assert.throws(
      () => verifiers[c.kind](c.document, roots),
      refused(c.error, codes[index]),
      c.description,
    ),
  );
  // Not with the built-in root either: the vector keys are trusted nowhere.
  const valid = await vector('02-activation.json');
  const builtIn = (await import('../packages/signing/dist/index.js')).licenseKeys;
  assert.throws(
    () => verifyActivationToken(valid.document, builtIn),
    refused('signature', 'unknown_key'),
  );
});

test('the envelope is read strictly: fields once, format 2, canonical base64url', () => {
  const a = licenceAuthority();
  const text = a.token();
  assert.ok(verifyActivationToken(text, a.roots));
  const twice = text.replace('{"format":2,', '{"format":2,"format":2,');
  assert.throws(
    () => verifyActivationToken(twice, a.roots),
    refused('malformed', 'envelope_invalid'),
  );
  const envelope = JSON.parse(text);
  const variants = [
    { ...envelope, format: 1 },
    { ...envelope, extra: true },
    { format: 2, payload: envelope.payload, signature: envelope.signature },
    { ...envelope, payload: `${envelope.payload}=` },
    { ...envelope, payload: `${envelope.payload}.` },
    { ...envelope, chain: [{ ...envelope.chain[0], extra: 1 }] },
  ];
  for (const variant of variants)
    assert.throws(
      () => verifyActivationToken(JSON.stringify(variant), a.roots),
      refused('malformed'),
      JSON.stringify(Object.keys(variant)),
    );
  assert.throws(
    () => verifyActivationToken(' '.repeat(1024 * 1024 + 1), a.roots),
    refused('malformed', 'document_too_large'),
  );
});

test('signatures: legacy algorithm, foreign purpose and a forged comment are refused', () => {
  const a = licenceAuthority();
  const bytes = Buffer.from(JSON.stringify(a.tokenPayload()));
  const comment = 'timestamp:1\tfile:licence-activation';
  const value = edSign(null, bytes, createPrivateKey(a.online.pem));
  const global = edSign(
    null,
    Buffer.concat([value, Buffer.from(comment)]),
    createPrivateKey(a.online.pem),
  );
  const legacy = [
    'untrusted comment: legacy',
    Buffer.concat([Buffer.from('Ed'), Buffer.from(a.online.id, 'hex'), value]).toString('base64'),
    `trusted comment: ${comment}`,
    global.toString('base64'),
    '',
  ].join('\n');
  const envelope = {
    format: 2,
    payload: bytes.toString('base64url'),
    signature: legacy,
    chain: [JSON.parse(a.onlineCertificate)],
  };
  assert.throws(
    () => verifyActivationToken(JSON.stringify(envelope), a.roots),
    refused('signature', 'signature_algorithm'),
  );
  assert.throws(
    () => verifyActivationToken(a.token({}, { purpose: 'licence-revocation' }), a.roots),
    refused('signature', 'signature_purpose'),
  );
  // file:licence-activation-x is not file:licence-activation.
  assert.throws(
    () => verifyActivationToken(a.token({}, { comment: 'file:licence-activation-x' }), a.roots),
    refused('signature', 'signature_purpose'),
  );
  const forged = JSON.parse(a.token());
  forged.signature = forged.signature.replace('file:licence-activation', 'file:licence-revocation');
  assert.throws(
    () => verifyActivationToken(JSON.stringify(forged), a.roots),
    refused('signature', 'signature_invalid'),
  );
});

test('the chain leads to a root, once, for this kind, in its window and token length', () => {
  const a = licenceAuthority();
  const revocationOnly = a.certificate(a.online, ['revocation']);
  assert.throws(
    () => verifyActivationToken(a.token({}, { chain: [revocationOnly] }), a.roots),
    refused('chain', 'chain_kind'),
  );
  assert.throws(
    () =>
      verifyActivationToken(
        a.token({}, { chain: [a.onlineCertificate, a.onlineCertificate] }),
        a.roots,
      ),
    refused('chain', 'chain_length'),
  );
  const nested = JSON.parse(a.onlineCertificate);
  nested.chain = [JSON.parse(a.onlineCertificate)];
  assert.throws(
    () => verifyActivationToken(a.token({}, { chain: [JSON.stringify(nested)] }), a.roots),
    refused('chain', 'chain_not_direct'),
  );
  const toItself = a.certificate(a.root, ['activation']);
  assert.throws(
    () =>
      verifyActivationToken(
        a.token({ keyId: a.root.id }, { signer: a.root, chain: [toItself] }),
        a.roots,
      ),
    refused('chain', 'chain_self'),
  );
  // A key delegated by the online key itself is not delegated by a root.
  const byOnline = a.certificate(a.offline, ['activation'], { signer: a.online });
  assert.throws(
    () =>
      verifyActivationToken(
        a.token({ keyId: a.offline.id }, { signer: a.offline, chain: [byOnline] }),
        a.roots,
      ),
    refused('signature', 'unknown_key'),
  );
  const late = Date.parse('2026-10-01T00:00:00Z') + 400 * DAY;
  assert.throws(
    () => verifyActivationToken(a.token({ issuedAtMs: late }), a.roots),
    refused('chain', 'chain_window'),
  );
  const short = a.certificate(a.online, ['activation'], { maxTokenDays: 10 });
  assert.throws(
    () => verifyActivationToken(a.token({}, { chain: [short] }), a.roots),
    refused('chain', 'chain_token_days'),
  );
  assert.throws(
    () => verifyActivationToken(a.token({ keyId: '00000000000000aa' }), a.roots),
    refused('malformed', 'key_mismatch'),
  );
});

test('payload fields are a closed set with exact forms', () => {
  const a = licenceAuthority();
  const issued = Date.parse('2026-10-02T00:00:00Z');
  const wrong = [
    { extra: 1 },
    { kind: 'revocation' },
    { product: 'other' },
    { format: 1 },
    { issuedAt: '2026-10-02T00:00:00.000Z' },
    { issuedAt: '2026-10-02T00:00:00+00:00' },
    { licenceNotAfter: '2027-02-29T00:00:00Z' },
    { limits: { sites: '18446744073709551616' } },
    { limits: { sites: 1 } },
    { limits: { sites: '-1' } },
    { seq: 0 },
    { seq: 1.5 },
    { graceDays: 91 },
    { nonce: 'short' },
    { installation: 'bad id with spaces' },
    { licenceId: 'lic_0123' },
    { type: 'Trial' },
    { licensee: 'x'.repeat(129) },
    { licensee: 'line\nbreak' },
    { wm: 'zz' },
  ];
  for (const fields of wrong)
    assert.throws(
      () => verifyActivationToken(a.token({ issuedAtMs: issued, ...fields }), a.roots),
      refused('malformed'),
      JSON.stringify(fields),
    );
  const missing = a.tokenPayload();
  delete missing.updatesUntil;
  assert.throws(
    () =>
      verifyActivationToken(
        seal(missing, a.online, 'licence-activation', [a.onlineCertificate]),
        a.roots,
      ),
    (error) => error.code === 'payload_invalid' && error.subject === '/updatesUntil',
  );
  const unknownType = verifyActivationToken(a.token({ type: 'galactic' }), a.roots);
  assert.equal(unknownType.document.type, 'galactic', 'an unknown licence type is shown as it is');
  assert.equal(licenceTime('2028-02-29T00:00:00Z'), Date.parse('2028-02-29T00:00:00Z'));
  assert.equal(licenceTime('2026-10-18T24:00:00Z'), null);
});

test('token times stay inside the licence, the offline window and the trial rules', () => {
  const a = licenceAuthority();
  const issued = Date.parse('2026-10-02T00:00:00Z');
  const outOfBounds = [
    { refreshAfter: iso(issued + 31 * DAY) },
    { refreshAfter: iso(issued - 1000) },
    { licenceNotAfter: iso(issued + 10 * DAY), graceDays: 5 },
    { type: 'trial', graceDays: 0, notAfter: iso(issued + 8 * DAY) },
    { type: 'trial', graceDays: 3, notAfter: iso(issued + 7 * DAY) },
  ];
  for (const fields of outOfBounds)
    assert.throws(
      () => verifyActivationToken(a.token({ issuedAtMs: issued, ...fields }), a.roots),
      refused('malformed', 'out_of_bounds'),
      JSON.stringify(fields),
    );
  const long = a.certificate(a.online, ['activation'], { maxTokenDays: 120 });
  assert.throws(
    () =>
      verifyActivationToken(
        a.token({ issuedAtMs: issued, notAfter: iso(issued + 91 * DAY) }, { chain: [long] }),
        a.roots,
      ),
    refused('malformed', 'out_of_bounds'),
    'an online token is never longer than 90 days',
  );
  const trial = verifyActivationToken(
    a.token({ issuedAtMs: issued, type: 'trial', graceDays: 0, notAfter: iso(issued + 7 * DAY) }),
    a.roots,
  );
  assert.equal(trial.document.type, 'trial');
  const perpetual = verifyActivationToken(a.token({ licenceNotAfter: null }), a.roots);
  assert.equal(perpetual.document.licenceNotAfter, null);
  const offline = verifyOfflineActivation(
    a.offlineToken({
      issuedAtMs: issued,
      notAfter: iso(issued + 365 * DAY),
      licenceNotAfter: null,
    }),
    a.roots,
  );
  assert.equal(offline.document.kind, 'offline-activation');
  assert.throws(
    () => verifyActivationToken(a.offlineToken(), a.roots),
    refused('chain', 'chain_kind'),
  );
});

test('revocation statements and lists', () => {
  const a = licenceAuthority();
  const statement = verifyRevocationStatement(
    a.revocation({ reason: 'activation_released' }),
    a.roots,
  );
  assert.equal(statement.document.reason, 'activation_released');
  assert.throws(
    () => verifyRevocationStatement(a.revocation({ reason: 'refund' }), a.roots),
    refused('malformed'),
  );
  assert.throws(
    () => verifyRevocationStatement(a.token(), a.roots),
    refused('signature', 'signature_purpose'),
  );
  const list = verifyLicenceRevocationList(
    a.revocationList({
      number: 7,
      licences: [{ licenceId: newId('lic'), reason: 'refund' }],
      certificates: [a.online.id],
    }),
    a.roots,
  );
  assert.equal(list.document.number, 7);
  assert.deepEqual(list.document.certificates, [a.online.id]);
  for (const fields of [
    { number: 0 },
    { extra: [] },
    { licences: [{ licenceId: newId('lic') }] },
    { certificates: ['x'] },
  ])
    assert.throws(
      () => verifyLicenceRevocationList(a.revocationList(fields), a.roots),
      refused('malformed'),
      JSON.stringify(fields),
    );
  assert.throws(
    () => verifyLicenceRevocationList(a.revocationList({}, a.online), a.roots),
    refused('signature', 'unknown_key'),
    'only the root signs a list',
  );
});

test('licence keys are normalised with their checksum and never needed in clear afterwards', () => {
  const key = licenceKeyText();
  assert.equal(normaliseLicenceKey(key), key);
  assert.equal(normaliseLicenceKey(` ${key.toLowerCase().replaceAll('-', ' ')} `), key);
  const body = key.slice('ARKV-K1-'.length);
  assert.equal(
    normaliseLicenceKey(`ARKV-K1-${body.replaceAll('0', 'O').replaceAll('1', 'L')}`),
    key,
  );
  const at = key.length - 2;
  const typos = [...'0123456789ABCDEFGHJKMNPQRSTVWXYZ']
    .filter((c) => c !== key[at])
    .filter((c) => normaliseLicenceKey(key.slice(0, at) + c + key.slice(at + 1)) !== null);
  assert.ok(typos.length < 3, `${typos.length} of 31 typos passed`);
  assert.equal(normaliseLicenceKey('ARKV-K2-' + body), null);
  assert.equal(normaliseLicenceKey('ARKV-K1-short'), null);
  assert.match(licenceKeyDigest(key), /^[0-9a-f]{64}$/);
});

test('strict JSON refuses repeated keys and deep nesting', () => {
  assert.deepEqual(strictJson('{"a":[1,{"b":"\\u0041"}],"c":null}'), {
    a: [1, { b: 'A' }],
    c: null,
  });
  for (const text of [
    '{"a":1,"a":2}',
    '{"a":{"b":1,"b":1}}',
    '[1,]',
    '{"a":"\u0001"}',
    '01',
    '{}x',
  ])
    assert.throws(() => strictJson(text), SyntaxError, text);
  assert.throws(() => strictJson('['.repeat(40) + ']'.repeat(40)), SyntaxError);
});

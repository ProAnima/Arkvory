import { createHash, randomBytes } from 'node:crypto';
import { signMinisign } from '../packages/signing/dist/index.js';
import { testKey } from './module-fixtures.mjs';

/**
 * Licence documents for tests, signed with throwaway keys made at run time: a root standing in
 * for the built-in licence root, the hub's online key (activations and revocations) and an
 * offline-activation key. Nothing here is trusted outside the test that made it.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DAY = 24 * 60 * 60 * 1000;
export const iso = (ms) => `${new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;

export function crockford(bytes, characters) {
  let out = '';
  for (let index = 0; index < characters; index++) {
    let value = 0;
    for (let bit = index * 5; bit < index * 5 + 5; bit++) {
      const set = bit < bytes.length * 8 && (bytes[bit >> 3] & (0x80 >> (bit & 7))) !== 0;
      value = (value << 1) | (set ? 1 : 0);
    }
    out += ALPHABET[value];
  }
  return out;
}

export const newId = (prefix) => `${prefix}_${crockford(randomBytes(16), 26)}`;

/** A well-formed licence key with its checksum, as the site would issue one. */
export function licenceKeyText() {
  const random = randomBytes(15);
  const digest = createHash('sha256').update('ARKV-K1').update(random).digest();
  const sum = (digest[0] << 2) | (digest[1] >> 6);
  const body = crockford(Buffer.concat([random, Buffer.from([sum >> 2, (sum & 3) << 6])]), 26);
  return `ARKV-K1-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}-${body.slice(20)}`;
}

/** The envelope text of `payload` signed by `signer` for `purpose`. */
export function seal(payload, signer, purpose, chain = [], options = {}) {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const comment = options.comment ?? `timestamp:1\tfile:${purpose}`;
  const signature = signMinisign(bytes, signer.pem, signer.id, comment, 'test licence signature');
  return JSON.stringify({
    format: 2,
    payload: bytes.toString('base64url'),
    signature,
    chain: chain.map((text) => JSON.parse(text)),
  });
}

/** A test licence authority: the root, its certificates and documents of the hub. */
export function licenceAuthority(start = Date.parse('2026-10-01T00:00:00Z')) {
  const root = testKey();
  const online = testKey();
  const offline = testKey();
  const certificate = (key, purposes, options = {}) =>
    seal(
      {
        format: 2,
        kind: 'delegation',
        product: 'arkvory',
        keyId: key.id,
        publicKey: key.key.publicKey,
        purposes,
        notBefore: iso(options.notBefore ?? start),
        notAfter: iso(options.notAfter ?? start + 365 * DAY),
        maxTokenDays: options.maxTokenDays ?? 90,
      },
      options.signer ?? root,
      'licence-delegation',
    );
  const onlineCertificate = certificate(online, ['activation', 'revocation']);
  const offlineCertificate = certificate(offline, ['offline-activation'], { maxTokenDays: 365 });
  const tokenPayload = (fields = {}) => {
    const issued = fields.issuedAtMs ?? start + DAY;
    const payload = {
      format: 2,
      kind: 'activation',
      product: 'arkvory',
      tokenId: newId('tok'),
      licenceId: fields.licenceId ?? newId('lic'),
      activationId: fields.activationId ?? newId('act'),
      type: 'standard',
      licensee: 'ACME GmbH',
      installation: fields.installation ?? '3f2b8c1e-7d4a-4e9b-a6c5-0f1e2d3c4b5a',
      features: ['dedup', 'delta'],
      limits: { sites: '1', 'storage.logicalBytes': '18446744073709551615' },
      issuedAt: iso(issued),
      refreshAfter: iso(issued + DAY),
      notAfter: iso(issued + 30 * DAY),
      licenceNotAfter: iso(issued + 365 * DAY),
      graceDays: 30,
      updatesUntil: null,
      seq: 1,
      nonce: 'q2vYgM3xT0yJ7bFhK9wNcA',
      wm: '8f3c2a1b0e9d8c7b6a5f4e3d2c1b0a99',
      keyId: online.id,
      ...fields,
    };
    delete payload.issuedAtMs;
    return payload;
  };
  return {
    root,
    online,
    offline,
    roots: [root.key],
    certificate,
    onlineCertificate,
    tokenPayload,
    token: (fields, options = {}) =>
      seal(
        tokenPayload(fields),
        options.signer ?? online,
        options.purpose ?? 'licence-activation',
        options.chain ?? [onlineCertificate],
        options,
      ),
    offlineToken: (fields) =>
      seal(
        tokenPayload({ kind: 'offline-activation', keyId: offline.id, ...fields }),
        offline,
        'licence-offline-activation',
        [offlineCertificate],
      ),
    revocation: (fields) =>
      seal(
        {
          format: 2,
          kind: 'revocation',
          product: 'arkvory',
          licenceId: newId('lic'),
          activationId: newId('act'),
          installation: '3f2b8c1e-7d4a-4e9b-a6c5-0f1e2d3c4b5a',
          reason: 'licence_revoked',
          revokedAt: iso(start + 2 * DAY),
          issuedAt: iso(start + 2 * DAY),
          seq: 2,
          nonce: 'Zr7Kp1Qs9Tn3Vb5Xd8Fg2H',
          keyId: online.id,
          ...fields,
        },
        online,
        'licence-revocation',
        [onlineCertificate],
      ),
    revocationList: (fields, signer = root) =>
      seal(
        {
          format: 2,
          kind: 'revocation-list',
          product: 'arkvory',
          number: 1,
          issuedAt: iso(start + DAY),
          licences: [],
          certificates: [],
          ...fields,
        },
        signer,
        'licence-revocation-list',
      ),
  };
}

import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// Test-only self-signed certificates built with node:crypto: no openssl binary on every lane and
// no private key committed as a fixture. Minimal DER: v3, ECDSA P-256, CN and SAN localhost.
function length(size) {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const sequence = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const explicit = (index, content) => tlv(0xa0 + index, content);
function integer(bytes) {
  const value = Buffer.from(bytes);
  return tlv(0x02, value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}
function oid(text) {
  const [first, second, ...rest] = text.split('.').map(Number);
  const out = [40 * first + second];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift(0x80 | (value & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(date) {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return tlv(0x17, Buffer.from(text, 'ascii'));
}
const ecdsaSha256 = sequence(oid('1.2.840.10045.4.3.2'));

export function selfSignedCertificate({
  notBefore = new Date(Date.now() - 60_000),
  days = 30,
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const name = sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from('localhost')))));
  const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);
  const altNames = sequence(
    tlv(0x82, Buffer.from('localhost')),
    tlv(0x87, Buffer.from([127, 0, 0, 1])),
  );
  const extensions = explicit(
    3,
    sequence(
      sequence(oid('2.5.29.19'), tlv(0x04, sequence(tlv(0x01, Buffer.from([0xff]))))),
      sequence(oid('2.5.29.17'), tlv(0x04, altNames)),
    ),
  );
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = sequence(
    explicit(0, integer([2])),
    integer(serial),
    ecdsaSha256,
    name,
    sequence(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    notAfter,
  };
}

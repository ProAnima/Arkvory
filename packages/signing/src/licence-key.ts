import { createHash } from 'node:crypto';

/**
 * A licence key as the ProAnimaStudio site issues it (ADR 0078, R1): `ARKV-K1-` and 26 Crockford
 * base32 characters holding 120 random bits and a 10-bit checksum, the first 10 bits of
 * SHA-256("ARKV-K1" ‖ random bytes). The checksum only catches typing mistakes before a request
 * reaches the hub; it gives no security. The key is a secret: the core reads it from a file,
 * sends it only in the body of an activation request and never stores or logs it.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'ARKV-K1';
const KEY_CHARACTERS = 26;
const RANDOM_BYTES = 15;

function decode(character: string): number | null {
  const typed = character === 'O' ? '0' : character === 'I' || character === 'L' ? '1' : character;
  const value = ALPHABET.indexOf(typed);
  return value < 0 ? null : value;
}

/**
 * The one spelling of a typed key (case, spaces and hyphens do not matter; O reads as 0, I and L
 * as 1), or null when the text is not a key or carries a typo.
 */
export function normaliseLicenceKey(typed: string): string | null {
  if (typed.length > 128) return null;
  const compact = typed.replace(/[\s-]/g, '').toUpperCase();
  if (!compact.startsWith('ARKVK1')) return null;
  const body = compact.slice('ARKVK1'.length);
  if (body.length !== KEY_CHARACTERS) return null;
  const values = Array.from({ length: body.length }, (_, index) => decode(body.charAt(index)));
  if (values.some((value) => value === null)) return null;
  const bits = values.flatMap((value) =>
    [4, 3, 2, 1, 0].map((shift) => (((value ?? 0) >> shift) & 1) === 1),
  );
  const random = Buffer.alloc(RANDOM_BYTES);
  bits.slice(0, RANDOM_BYTES * 8).forEach((bit, index) => {
    if (bit) random[index >> 3] = (random[index >> 3] ?? 0) | (0x80 >> (index & 7));
  });
  const sum = bits.slice(RANDOM_BYTES * 8).reduce((acc, bit) => (acc << 1) | (bit ? 1 : 0), 0);
  const digest = createHash('sha256').update(PREFIX).update(random).digest();
  if (sum !== (((digest[0] ?? 0) << 2) | ((digest[1] ?? 0) >> 6))) return null;
  const canonical = values.map((value) => ALPHABET[value ?? 0]).join('');
  const groups = [0, 5, 10, 15, 20].map((at) => canonical.slice(at, at === 20 ? 26 : at + 5));
  return `${PREFIX}-${groups.join('-')}`;
}

/** SHA-256 of the normalised key, hex: what an offline request names instead of the key. */
export function licenceKeyDigest(normalised: string): string {
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

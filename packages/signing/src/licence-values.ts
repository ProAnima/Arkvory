/**
 * Value forms of licence documents (the hub's `docs/licence-format.md`, section 3). Each reader
 * takes `unknown` and returns the checked value or null; the document reader turns null into
 * `malformed` with the field's JSON Pointer.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const CROCKFORD = '[0-9A-HJKMNP-TV-Z]';
const U64_MAX = 18446744073709551615n;

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's algorithm, as the hub). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Milliseconds of `YYYY-MM-DDTHH:MM:SSZ` exactly: no fractions, offsets or other spellings, and
 * the date must exist (`2027-02-29` is refused). Null for anything else.
 */
export function licenceTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = TIME.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const days = daysFromCivil(year, month, day);
  // 31 February comes back as 3 March: the date must survive the round trip.
  const back = new Date(days * DAY_MS);
  if (back.getUTCDate() !== day || back.getUTCMonth() + 1 !== month) return null;
  return days * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000;
}

/** The one spelling of a time, for documents the core writes (offline requests). */
export function formatLicenceTime(ms: number): string {
  return `${new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

const pattern = (expression: RegExp) => (value: unknown) =>
  typeof value === 'string' && expression.test(value) ? value : null;

/** `lic_`, `act_` or `tok_` and 26 Crockford base32 characters. */
export const licenceId = pattern(new RegExp(`^lic_${CROCKFORD}{26}$`));
export const activationId = pattern(new RegExp(`^act_${CROCKFORD}{26}$`));
export const tokenId = pattern(new RegExp(`^tok_${CROCKFORD}{26}$`));
/** An install id: 8–64 characters of `[A-Za-z0-9-]`. */
export const installationId = pattern(/^[A-Za-z0-9-]{8,64}$/);
/** A request nonce: 16–128 characters of `[A-Za-z0-9_-]`. */
export const licenceNonce = pattern(/^[A-Za-z0-9_-]{16,128}$/);
export const keyIdOf = pattern(/^[0-9a-f]{16}$/);
/** The hub's watermark of an issue: 32 hex digits. */
export const watermark = pattern(/^[0-9a-f]{32}$/);
/** A licence type: known ones are `trial`, `standard`, `multi-site`, `enterprise`; others pass. */
export const licenceType = pattern(/^[a-z][a-z0-9-]{1,31}$/);
/** A name of a feature or limit, such as `dedup` or `storage.logicalBytes`. */
export const licenceName = pattern(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/);
/** A machine reason of a revocation list entry. */
export const reasonCode = pattern(/^[a-z][a-z0-9_]{0,63}$/);

/** The organisation's name: 1–128 characters, no control characters. */
export function licenseeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let count = 0;
  // for…of walks code points, as the hub counts characters.
  for (const character of value) {
    count++;
    if (/\p{Cc}/u.test(character)) return null;
  }
  return count >= 1 && count <= 128 ? value : null;
}

/** A whole JSON number in `[minimum, maximum]`. */
export function wholeNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

/** The decimal digits of an unsigned 64-bit number: values above 2^53 survive as text. */
export function decimalLimit(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null;
  return BigInt(value) <= U64_MAX ? value : null;
}

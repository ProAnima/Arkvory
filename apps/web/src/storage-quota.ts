const gib = 1024n ** 3n;
const maximum = 9007199254740991n;

/**
 * Converts a quota typed in GiB ("50", "0.5" or "0,5", at most three decimals) into the exact
 * byte string of the API contract. Empty input means no repository quota.
 */
export function quotaBytes(text: string): string | null {
  const value = text.trim().replace(',', '.');
  if (!value) return null;
  const match = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new RangeError('Invalid quota');
  const whole = BigInt(match[1] ?? '0');
  const thousandths = BigInt((match[2] ?? '').padEnd(3, '0'));
  const bytes = whole * gib + (thousandths * gib) / 1000n;
  if (bytes < 1n || bytes > maximum) throw new RangeError('Invalid quota');
  return bytes.toString();
}

/** Shows a stored byte quota in GiB, rounded to three decimals for editing. */
export function quotaGib(bytes: string): string {
  const value = BigInt(bytes);
  let whole = value / gib;
  let thousandths = ((value % gib) * 1000n + gib / 2n) / gib;
  if (thousandths === 1000n) {
    whole += 1n;
    thousandths = 0n;
  }
  if (thousandths === 0n) return whole.toString();
  return `${whole.toString()}.${thousandths.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

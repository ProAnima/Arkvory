export type RelativeUnit = 'second' | 'minute' | 'hour' | 'day';

/**
 * Amount and unit for Intl.RelativeTimeFormat between `at` and `now` (milliseconds); the
 * past is negative. Hours run up to two days, so a 26-hour-old backup reads as 26 hours rather
 * than "yesterday". Values truncate toward zero: 59.9 minutes is still 59 minutes.
 */
export function relativeParts(at: number, now: number): { value: number; unit: RelativeUnit } {
  const seconds = Math.trunc((at - now) / 1000);
  const size = Math.abs(seconds);
  // `|| 0` turns -0 into 0, which Intl formats as "now" instead of "0 seconds ago".
  if (size < 60) return { value: seconds || 0, unit: 'second' };
  if (size < 3600) return { value: Math.trunc(seconds / 60) || 0, unit: 'minute' };
  if (size < 48 * 3600) return { value: Math.trunc(seconds / 3600) || 0, unit: 'hour' };
  return { value: Math.trunc(seconds / 86400) || 0, unit: 'day' };
}

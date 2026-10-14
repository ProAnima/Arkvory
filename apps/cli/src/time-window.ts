import { CliError } from './errors.js';
import type { Arguments } from './arguments.js';

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A moment of `--not-before` or `--not-after`: an RFC 3339 time, or `HH:MM` local time, the next
 * time the clock shows it (22:00 at 23:00 is tomorrow).
 */
export function moment(value: string, now: Date, option: string): Date {
  if (rfc3339.test(value)) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return new Date(at);
  }
  const parts = clock.exec(value);
  if (!parts) throw new CliError(`invalid_${option.replaceAll('-', '_')}`);
  const at = new Date(now);
  at.setHours(Number(parts[1]), Number(parts[2]), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** The download window of ADR 0076 from `--not-before` and `--not-after`, if given. */
export function downloadWindow(args: Arguments, now = new Date()) {
  const before = args.options.get('not-before');
  const after = args.options.get('not-after');
  const notBefore = before === undefined ? undefined : moment(before, now, 'not-before');
  const notAfter = after === undefined ? undefined : moment(after, notBefore ?? now, 'not-after');
  return {
    ...(notBefore ? { notBefore } : {}),
    ...(notAfter ? { notAfter } : {}),
  };
}

import { ArkvoryError } from '@proanima/arkvory-domain';

/** Use transaction database time and never let a delegated key outlive its issuer. */
export function serviceKeyExpiry(now: Date, requested: string | undefined, issuer?: Date): Date {
  const expires =
    requested === undefined
      ? new Date(Math.min(now.getTime() + 90 * 86400000, issuer?.getTime() ?? Infinity))
      : new Date(requested);
  if (
    !Number.isFinite(expires.getTime()) ||
    expires <= now ||
    expires.getTime() > now.getTime() + 365 * 86400000
  )
    throw new ArkvoryError('invalid_input', 'Key expiry must be within 365 days');
  if (issuer && expires > issuer)
    throw new ArkvoryError('forbidden', 'Issued key cannot outlive operator credential');
  return expires;
}

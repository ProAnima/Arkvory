import { ArkvoryError } from './errors.js';
import type { Principal } from './artifact.js';

/**
 * The global administrator of this installation, by an account or a file key with the flag; a
 * service key never is one, whatever its permissions. The one check of the `system/*` routes and
 * of module routes with `access: 'administrator'` (ADR 0083, N12).
 */
export function requireAdministrator(principal: Principal): void {
  if (principal.managed || principal.administrator !== true)
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
}

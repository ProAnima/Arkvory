import type { MutationAccess } from '@proanima/arkvory-domain';

// Matches both server-generated UUIDs and accepted proxy IDs; the column is varchar(128).
const storedRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Correlation value persisted with jobs and audit rows; anything unexpected is stored as NULL. */
export function storedCorrelation(value: string | null | undefined): string | null {
  return typeof value === 'string' && storedRequestId.test(value) ? value : null;
}

export function accessCorrelation(access: MutationAccess | undefined): string | null {
  return storedCorrelation(access?.principal.requestId);
}

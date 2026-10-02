import { ArkvoryError, requireId } from '@proanima/arkvory-domain';

/**
 * Opaque keyset cursor of backup pages: microseconds of the ordering timestamp and the row id.
 * Microseconds keep PostgreSQL timestamp precision, so equal milliseconds never skip a row.
 */
export function encodeCursor(microseconds: string, id: string): string {
  return `${microseconds}_${id}`;
}

export function decodeCursor(cursor: string): { readonly at: string; readonly id: string } {
  const match = /^([0-9]{1,17})_(.+)$/.exec(cursor);
  const at = match?.[1];
  const id = match?.[2];
  if (at === undefined || id === undefined)
    throw new ArkvoryError('invalid_input', 'Invalid page cursor', {
      reason: 'validation',
      details: [{ field: 'after', problem: 'format' }],
    });
  return { at, id: requireId(id) };
}

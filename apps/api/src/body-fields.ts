import { ArkvoryError } from '@proanima/arkvory-domain';

/** Closed JSON object: unknown fields are rejected instead of silently ignored. */
export function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Expected an object');
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(body).some((key) => !names.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown field');
  return body;
}

import { ArkvoryError, MAX_ERROR_DETAILS, nestedFields } from '@proanima/arkvory-domain';
import type { ErrorDetail } from '@proanima/arkvory-domain';

const pointer = (name: string) => '/' + name.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * Closed JSON object: unknown fields are rejected instead of silently ignored. Failures name
 * the offending members (body: JSON Pointer, query: parameter name), never their values.
 */
export function fields(
  value: unknown,
  names: readonly string[],
  options: { readonly required?: readonly string[]; readonly in?: 'body' | 'query' } = {},
): Record<string, unknown> {
  const location = options.in === 'query' ? (name: string) => name : pointer;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Expected an object', {
      details: options.in === 'query' ? [] : [{ field: '/', problem: 'type' }],
    });
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const details: ErrorDetail[] = [
    ...Object.keys(body)
      .filter((key) => !names.includes(key))
      .map((key) => ({ field: location(key), problem: 'unknown_field' as const })),
    ...(options.required ?? [])
      .filter((key) => body[key] === undefined)
      .map((key) => ({ field: location(key), problem: 'required' as const })),
  ];
  // Field names are client-chosen; long names are not echoed into the bounded detail list.
  const named = details.filter((detail) => detail.field.length <= 256).slice(0, MAX_ERROR_DETAILS);
  if (details.some((detail) => detail.problem === 'unknown_field'))
    throw new ArkvoryError('invalid_input', 'Unknown field', { details: named });
  if (details.length) throw new ArkvoryError('invalid_input', 'Missing field', { details: named });
  return body;
}

/** Validation pointers of a service that parses one body member are rebased under it. */
export async function nestedBody<T>(prefix: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    return nestedFields(prefix, () => {
      throw error;
    });
  }
}

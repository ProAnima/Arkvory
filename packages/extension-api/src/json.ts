/** A JSON value: what a module's normalized configuration may contain. */
export type ModuleJson =
  null | boolean | number | string | readonly ModuleJson[] | { readonly [key: string]: ModuleJson };

/**
 * JSON text with object keys in UTF-16 code unit order (as RFC 8785 sorts them) and no
 * whitespace, so equal values always give equal text. Non-finite numbers have no JSON form and
 * are refused.
 */
export function canonicalJson(value: ModuleJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Non-finite number in module JSON');
    return JSON.stringify(value);
  }
  if (isList(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(member(value, key))}`).join(',')}}`;
}

function isList(value: ModuleJson): value is readonly ModuleJson[] {
  return Array.isArray(value);
}

function member(value: { readonly [key: string]: ModuleJson }, key: string): ModuleJson {
  const found = value[key];
  if (found === undefined) throw new TypeError('Undefined member in module JSON');
  return found;
}

// JSON schemas of the contract as a reader sees them: a table of fields with their types and
// rules, and a sample value for an example request. The words come from a language's site text
// (`api.rules`); JSON types and patterns stay as the schema writes them.
import { fill } from './site.mjs';

/** Decimal integers sent as strings (64-bit sizes, offsets and counters, ADR 0001). */
const DECIMAL =
  /^\^(\(0\|\[1-9\]\[0-9\](\{0,\d+\}|\*)\)|\[1-9\]\[0-9\]\{0,\d+\}|\[0-9\]\{1,\d+\})\$$/;
const SHA256 = '^[a-f0-9]{64}$';
/** Nested objects are listed to this depth; deeper ones are named by their type. */
const DEPTH = 3;

/** The non-null alternatives of a schema: `oneOf`/`anyOf` members, or the schema itself. */
function variants(schema) {
  const list = schema.oneOf ?? schema.anyOf;
  return list ? list.filter((s) => s.type !== 'null') : [schema];
}
const nullable = (schema) =>
  schema.nullable === true ||
  (Array.isArray(schema.type) && schema.type.includes('null')) ||
  (schema.oneOf ?? schema.anyOf ?? []).some((s) => s.type === 'null');

export function typeOf(schema, text) {
  const kinds = variants(schema).map((variant) => {
    const type = Array.isArray(variant.type)
      ? variant.type.filter((t) => t !== 'null').join(' | ')
      : variant.type;
    if (variant.const !== undefined) return JSON.stringify(variant.const);
    if (type === 'array')
      return fill(text.rules.arrayOf, { type: typeOf(variant.items ?? {}, text) });
    if (
      type === 'object' &&
      !variant.properties &&
      typeof variant.additionalProperties === 'object'
    )
      return fill(text.rules.mapOf, { type: typeOf(variant.additionalProperties, text) });
    const base = type ?? (variant.enum ? 'string' : 'object');
    return variant.format ? `${base} (${variant.format})` : base;
  });
  return [...new Set(kinds)].join(' | ');
}

const code = (value) => `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
function range(rules, min, max, words) {
  if (min !== undefined && max !== undefined) return fill(rules[words.both], { min, max });
  if (max !== undefined) return fill(rules[words.max], { max });
  if (min !== undefined) return fill(rules[words.min], { min });
  return undefined;
}

/** What a value must be, in words: length, count, range, enumeration, pattern. */
export function rulesOf(schema, text) {
  const rules = text.rules;
  const found = [];
  for (const variant of variants(schema)) {
    if (variant.enum) found.push(fill(rules.oneOf, { values: variant.enum.map(code).join(', ') }));
    if (variant.pattern === SHA256) found.push(rules.sha256);
    else if (variant.pattern && DECIMAL.test(variant.pattern)) found.push(rules.decimal);
    else if (variant.pattern) found.push(fill(rules.pattern, { pattern: code(variant.pattern) }));
    found.push(
      range(rules, variant.minLength, variant.maxLength, {
        both: 'length',
        min: 'minLength',
        max: 'maxLength',
      }),
      range(rules, variant.minItems, variant.maxItems, {
        both: 'items',
        min: 'minItems',
        max: 'maxItems',
      }),
      range(rules, variant.minimum, variant.maximum, {
        both: 'range',
        min: 'minimum',
        max: 'maximum',
      }),
      variant.maxProperties === undefined
        ? undefined
        : fill(rules.entries, { max: variant.maxProperties }),
      variant.uniqueItems ? rules.unique : undefined,
    );
    if (variant.type === 'array' && variant.items) {
      const inner = rulesOf(variant.items, text);
      if (inner) found.push(fill(rules.each, { rules: inner }));
    }
  }
  if (schema.default !== undefined)
    found.push(fill(rules.default, { value: code(schema.default) }));
  if (nullable(schema)) found.push(rules.nullable);
  return [...new Set(found.filter(Boolean))].join('; ');
}

/** The properties of an object schema (of every alternative), with whether each is required. */
function properties(schema) {
  const list = [];
  for (const variant of variants(schema))
    for (const [name, value] of Object.entries(variant.properties ?? {}))
      if (!list.some((p) => p.name === name))
        list.push({ name, schema: value, required: (variant.required ?? []).includes(name) });
  return list;
}

/** Rows of a fields table: `parent.child` and `items[].field` for nested values. */
export function fieldsOf(schema, text, path = '', depth = 1) {
  const rows = [];
  for (const { name, schema: value, required } of properties(schema)) {
    const field = `${path}${name}`;
    rows.push({
      field,
      type: typeOf(value, text),
      required,
      rules: rulesOf(value, text),
      description: value.description ?? '',
    });
    if (depth >= DEPTH) continue;
    for (const variant of variants(value)) {
      if (variant.properties) rows.push(...fieldsOf(variant, text, `${field}.`, depth + 1));
      if (variant.type === 'array' && variant.items?.properties)
        rows.push(...fieldsOf(variant.items, text, `${field}[].`, depth + 1));
    }
  }
  return rows.filter((row, index) => rows.findIndex((r) => r.field === row.field) === index);
}

/** A value of the schema for an example: required fields only, placeholders named by field. */
export function sample(schema, name = 'value') {
  const variant = variants(schema)[0] ?? {};
  if (variant.const !== undefined) return variant.const;
  if (variant.enum) return variant.enum[0];
  if (variant.default !== undefined) return variant.default;
  const type = Array.isArray(variant.type) ? variant.type.find((t) => t !== 'null') : variant.type;
  if (type === 'object' || variant.properties) {
    const value = {};
    for (const p of properties(variant)) if (p.required) value[p.name] = sample(p.schema, p.name);
    return value;
  }
  if (type === 'array') return variant.minItems ? [sample(variant.items ?? {}, name)] : [];
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return variant.minimum ?? 0;
  if (variant.pattern === SHA256) return `<${name}: SHA-256>`;
  if (variant.pattern && DECIMAL.test(variant.pattern)) return '1024';
  if (variant.format === 'date-time') return '2026-01-01T00:00:00.000Z';
  if (variant.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  return `<${name}>`;
}

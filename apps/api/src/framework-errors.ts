import { MAX_ERROR_DETAILS } from '@proanima/arkvory-domain';
import type { DetailProblem, ErrorDetail } from '@proanima/arkvory-domain';
import type { HttpFailure } from './http-failure.js';

// Fastify request-shape failures by their stable error code; messages stay fixed text.
const parserFailures: Readonly<Record<string, HttpFailure>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: {
    code: 'invalid_input',
    reason: 'body_too_large',
    message: 'Request body is too large',
  },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: 'invalid_input',
    reason: 'unsupported_media_type',
    message: 'Unsupported media type',
  },
  FST_ERR_CTP_INVALID_JSON_BODY: {
    code: 'invalid_input',
    reason: 'malformed_json',
    message: 'Request body is not valid JSON',
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    code: 'invalid_input',
    reason: 'malformed_json',
    message: 'Request body is not valid JSON',
  },
};
const problems: Readonly<Record<string, DetailProblem>> = {
  required: 'required',
  additionalProperties: 'unknown_field',
  type: 'type',
  pattern: 'format',
  format: 'format',
  minLength: 'length',
  maxLength: 'length',
  minItems: 'length',
  maxItems: 'length',
  minProperties: 'length',
  maxProperties: 'length',
  minimum: 'range',
  maximum: 'range',
  exclusiveMinimum: 'range',
  exclusiveMaximum: 'range',
};

function members(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}
const escape = (name: string) => name.replaceAll('~', '~0').replaceAll('/', '~1');

/** RFC 6901 pointer for body members; parameters are named without a leading slash. */
function location(context: unknown, item: Record<string, unknown>): string | undefined {
  const params = members(item['params']);
  const base = typeof item['instancePath'] === 'string' ? item['instancePath'] : '';
  const child = params['missingProperty'] ?? params['additionalProperty'];
  const path = typeof child === 'string' ? `${base}/${escape(child)}` : base;
  if (context === 'body') return path || '/';
  if (context === 'querystring' || context === 'params') return path.split('/')[1] || undefined;
  return undefined;
}

function validationDetails(error: Record<string, unknown>): readonly ErrorDetail[] {
  const items = Array.isArray(error['validation']) ? error['validation'] : [];
  const details: ErrorDetail[] = [];
  for (const entry of items.slice(0, MAX_ERROR_DETAILS)) {
    const item = members(entry);
    const field = location(error['validationContext'], item);
    if (field === undefined || field.length > 256) continue;
    const keyword = typeof item['keyword'] === 'string' ? item['keyword'] : '';
    const problem = problems[keyword] ?? 'invalid';
    if (!details.some((d) => d.field === field && d.problem === problem))
      details.push({ field, problem });
  }
  return details;
}

/** Client errors raised by Fastify itself; anything else is classified as a server failure. */
export function frameworkFailure(error: unknown): HttpFailure | undefined {
  const value = members(error);
  const status = value['statusCode'];
  if (typeof status !== 'number' || status < 400 || status >= 500) return undefined;
  const code = typeof value['code'] === 'string' ? value['code'] : '';
  const known = parserFailures[code];
  if (known) return known;
  const details = code === 'FST_ERR_VALIDATION' ? validationDetails(value) : [];
  return {
    code: 'invalid_input',
    reason: 'validation',
    message: 'Invalid request',
    ...(details.length ? { details } : {}),
  };
}

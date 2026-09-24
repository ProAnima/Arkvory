import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiDocument } from '@proanima/depot-contracts';

export const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false });
addFormats(ajv);
const validators = new WeakMap();
export function validateJson(schema, value) {
  let check = validators.get(schema);
  if (!check) {
    check = ajv.compile(schema);
    validators.set(schema, check);
  }
  assert.equal(check(value), true, JSON.stringify(check.errors));
}
export function validateResponse(path, method, response) {
  const operation = openApiDocument.paths[path][method.toLowerCase()];
  assert.ok(operation, `${method} ${path}`);
  const description =
    operation.responses[String(response.statusCode)] ?? operation.responses.default;
  assert.ok(description, `${method} ${path}: undocumented status ${response.statusCode}`);
  if (
    method.toLowerCase() === 'head' ||
    response.statusCode === 204 ||
    response.statusCode === 304 ||
    response.statusCode === 416
  ) {
    assert.equal(response.body, '');
    assert.equal(description.content, undefined);
    return;
  }
  const type = String(response.headers['content-type']).split(';')[0];
  const schema = description.content?.[type]?.schema;
  assert.ok(schema, `${method} ${path}: undocumented media type ${type}`);
  if (type === 'application/json') validateJson(schema, response.json());
}

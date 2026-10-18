import type { ModuleJson, ModuleManifest } from '@proanima/arkvory-extension-api';
import type { CheckedRoute } from './extension-route-check.js';
import { ModuleSetupError } from './module-host.js';

/** One module's OpenAPI fragment after the core checked it against the module's routes. */
export interface CheckedFragment {
  /** Operations by full path (`{name}` parameters) and lower-case method. */
  readonly paths: Readonly<Record<string, Readonly<Record<string, JsonObject>>>>;
  readonly schemas: Readonly<Record<string, ModuleJson>>;
}

type JsonObject = { readonly [key: string]: ModuleJson };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const OPERATION_FIELDS = [
  'operationId',
  'summary',
  'description',
  'tags',
  'parameters',
  'requestBody',
  'responses',
  'deprecated',
  'x-arkvory-access',
];
const BODY_TYPES = { json: 'application/json', stream: 'application/octet-stream' } as const;
/** A fragment beyond these is refused before it is looked at further. */
const MAX_FRAGMENT_BYTES = 256 * 1024;
const MAX_DEPTH = 32;
/** The core's schemas a fragment may refer to (ADR 0083, N12). */
export const SHARED_SCHEMAS = ['NativeError'];

const invalid = (path: string) => new ModuleSetupError('openapi_invalid', path);
/** The JSON Pointer of a member (RFC 6901): `~` and `/` of the key escaped. */
const child = (path: string, key: string) =>
  `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
const mismatch = (subject: string) => new ModuleSetupError('openapi_route_mismatch', subject);

const isList = (value: ModuleJson): value is readonly ModuleJson[] => Array.isArray(value);

const isObject = (value: ModuleJson | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A plain JSON copy of what the module passed: null, booleans, finite numbers, strings, arrays
 * and objects with own enumerable keys, at most MAX_DEPTH deep. The copy is what the core keeps
 * and serves, so the module cannot change it after the check.
 */
function jsonCopy(value: unknown, path: string, depth = 0): ModuleJson {
  if (depth > MAX_DEPTH) throw invalid(path);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item: unknown, index) =>
      jsonCopy(item, `${path}/${String(index)}`, depth + 1),
    );
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonCopy(item, child(path, key), depth + 1),
      ]),
    );
  throw invalid(path);
}

function object(value: ModuleJson | undefined, path: string, fields?: readonly string[]) {
  if (!isObject(value)) throw invalid(path);
  const unknown = fields && Object.keys(value).find((key) => !fields.includes(key));
  if (unknown !== undefined) throw invalid(child(path, unknown));
  return value;
}

/**
 * JSON Schema keywords that resolve against another document (`$id` changes the base of every
 * `$ref` below it); with them a reference would leave the fragment despite the `$ref` check.
 */
const FOREIGN_KEYWORDS = ['$id', '$schema', '$dynamicRef', '$recursiveRef'];

/** Every `$ref` names a schema of this fragment or one the core shares; nothing else resolves. */
function checkReferences(value: ModuleJson, schemas: ReadonlySet<string>, path: string): void {
  if (isList(value)) {
    value.forEach((item, index) => {
      checkReferences(item, schemas, `${path}/${String(index)}`);
    });
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (FOREIGN_KEYWORDS.includes(key)) throw invalid(child(path, key));
    if (key === '$ref') {
      const name = typeof item === 'string' ? /^#\/components\/schemas\/(.+)$/.exec(item)?.[1] : '';
      if (name === undefined || name === '' || !schemas.has(name)) throw invalid(`${path}/$ref`);
    } else checkReferences(item, schemas, child(path, key));
  }
}

function checkSchemas(top: JsonObject, manifest: ModuleManifest): Record<string, ModuleJson> {
  if (top['components'] === undefined) return {};
  const components = object(top['components'], '/components', ['schemas']);
  if (components['schemas'] === undefined) return {};
  const schemas = object(components['schemas'], '/components/schemas');
  const own = new RegExp(`^ext_${manifest.id.replaceAll('-', '_')}_[A-Za-z0-9_]{1,64}$`);
  for (const name of Object.keys(schemas))
    if (!own.test(name)) throw invalid(child('/components/schemas', name));
  return { ...schemas };
}

function checkOperation(value: ModuleJson | undefined, path: string): JsonObject {
  const operation = object(value, path, OPERATION_FIELDS);
  const summary = operation['summary'];
  if (typeof operation['operationId'] !== 'string') throw invalid(`${path}/operationId`);
  if (typeof summary !== 'string' || summary.length < 1 || summary.length > 1024)
    throw invalid(`${path}/summary`);
  const responses = object(operation['responses'], `${path}/responses`);
  if (Object.keys(responses).length === 0) throw invalid(`${path}/responses`);
  const access = operation['x-arkvory-access'];
  if (access !== 'authenticated' && access !== 'administrator')
    throw invalid(`${path}/x-arkvory-access`);
  if (operation['requestBody'] !== undefined) {
    const body = object(operation['requestBody'], `${path}/requestBody`, [
      'description',
      'required',
      'content',
    ]);
    const types = Object.keys(object(body['content'], `${path}/requestBody/content`));
    if (types.length !== 1 || !Object.values(BODY_TYPES).some((type) => type === types[0]))
      throw invalid(`${path}/requestBody/content`);
  }
  return operation;
}

/** The media type an operation documents for its body, or null without one. */
function bodyType(operation: JsonObject): string | null {
  const body = operation['requestBody'];
  if (!isObject(body) || !isObject(body['content'])) return null;
  return Object.keys(body['content'])[0] ?? null;
}

const documentedPath = (route: Pick<CheckedRoute, 'path'>) =>
  route.path.replace(/:([a-zA-Z0-9]+)/g, '{$1}');

/**
 * Both directions (ADR 0083, N12): each route has an operation with its method, path,
 * `operationId`, access and body, and each operation is a route of the module.
 */
function matchRoutes(paths: CheckedFragment['paths'], routes: readonly CheckedRoute[]): void {
  for (const route of routes) {
    const path = documentedPath(route);
    const method = route.method.toLowerCase();
    const operation = paths[path]?.[method];
    const subject = `${route.method} ${path}`;
    if (!operation) throw mismatch(subject);
    const body = route.body.kind === 'none' ? null : BODY_TYPES[route.body.kind];
    if (
      operation['operationId'] !== route.operationId ||
      operation['x-arkvory-access'] !== route.access ||
      bodyType(operation) !== body
    )
      throw mismatch(subject);
  }
  for (const [path, item] of Object.entries(paths))
    for (const method of Object.keys(item))
      if (!routes.some((r) => documentedPath(r) === path && r.method.toLowerCase() === method))
        throw mismatch(`${method.toUpperCase()} ${path}`);
}

/**
 * Reads a module's OpenAPI 3.1 fragment as untrusted input (`openapi_invalid` with the JSON
 * Pointer of the problem) and matches it with the routes the module declared
 * (`openapi_route_mismatch`). Paths are full paths under the module's prefixes; security schemes
 * and servers are the core's, so a fragment names none.
 */
export function checkFragment(
  value: unknown,
  manifest: ModuleManifest,
  routes: readonly CheckedRoute[],
): CheckedFragment {
  const copy = jsonCopy(value, '');
  if (Buffer.byteLength(JSON.stringify(copy)) > MAX_FRAGMENT_BYTES) throw invalid('');
  const top = object(copy, '', ['openapi', 'paths', 'components']);
  if (typeof top['openapi'] !== 'string' || !/^3\.1\.[0-9]{1,3}$/.test(top['openapi']))
    throw invalid('/openapi');
  const schemas = checkSchemas(top, manifest);
  checkReferences(copy, new Set([...Object.keys(schemas), ...SHARED_SCHEMAS]), '');
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const [path, item] of Object.entries(object(top['paths'], '/paths'))) {
    const pointer = child('/paths', path);
    const methods = object(item, pointer, METHODS);
    if (Object.keys(methods).length === 0) throw invalid(pointer);
    paths[path] = Object.fromEntries(
      Object.entries(methods).map(([method, operation]) => [
        method,
        checkOperation(operation, `${pointer}/${method}`),
      ]),
    );
  }
  matchRoutes(paths, routes);
  return { paths, schemas };
}

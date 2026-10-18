import { MAX_OBJECT_BYTES } from '@proanima/arkvory-domain';
import {
  MODULE_JSON_BODY_LIMIT,
  MODULE_ROUTE_ACTIONS,
  MODULE_ROUTE_METHODS,
  MODULE_ROUTE_TIMEOUT_LIMIT_MS,
} from '@proanima/arkvory-extension-api';
import type {
  ModuleManifest,
  ModuleRequest,
  ModuleRouteAction,
  ModuleRouteBody,
  ModuleRouteMethod,
  ModuleSignal,
} from '@proanima/arkvory-extension-api';
import { ModuleSetupError } from './module-host.js';

/** A module route after the core checked its declaration; `handle` answers untrusted output. */
export interface CheckedRoute {
  readonly module: string;
  readonly method: ModuleRouteMethod;
  /** The path in router syntax, `:name` for a parameter. */
  readonly path: string;
  readonly params: readonly string[];
  readonly operationId: string;
  readonly effect: 'read' | 'write';
  readonly access: 'authenticated' | 'administrator';
  readonly action: ModuleRouteAction | null;
  readonly repositoryParam: string | null;
  readonly body: ModuleRouteBody;
  readonly responseLimit: number;
  readonly timeoutMs: number;
  handle(request: ModuleRequest, signal: ModuleSignal): Promise<unknown>;
}

/** Actions that only read; the rest change the repository (`MODULE_ROUTE_ACTIONS`). */
export const READING_ACTIONS: readonly ModuleRouteAction[] = [
  'repository.read',
  'artifact.read',
  'artifact.list',
  'content.read',
  'package.read',
  'asset.read',
  'annotation.read',
];

const LITERAL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PARAMETER = /^:[a-z][a-zA-Z0-9]{0,31}$/;
const MAX_SEGMENTS = 16;

/** Reads fields of an object through its prototype too: a module may declare routes as classes. */
type Row = (key: string) => unknown;

const invalid = (path: string) => new ModuleSetupError('routes_invalid', path);

function row(value: unknown, path: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(path);
  return (key): unknown => Reflect.get(value, key);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw invalid(path);
  return found;
}

function count(value: unknown, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max)
    throw invalid(path);
  return value;
}

/** The path below one of the module's prefixes, and the names of its parameters. */
function routePath(value: unknown, manifest: ModuleManifest, at: string) {
  if (typeof value !== 'string' || value.length > 512) throw invalid(`${at}/path`);
  const prefix = manifest.routePrefixes.find((candidate) => value.startsWith(candidate));
  if (prefix === undefined) throw invalid(`${at}/path`);
  const segments = value.slice(prefix.length).split('/');
  if (
    segments.length > MAX_SEGMENTS ||
    segments.some((segment) => !LITERAL.test(segment) && !PARAMETER.test(segment))
  )
    throw invalid(`${at}/path`);
  const params = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1));
  if (new Set(params).size !== params.length) throw invalid(`${at}/path`);
  return { path: value, prefix, params };
}

function routeBody(value: unknown, at: string): ModuleRouteBody {
  const body = row(value, `${at}/body`);
  const kind = oneOf(body('kind'), ['none', 'json', 'stream'] as const, `${at}/body/kind`);
  if (kind === 'none') return { kind };
  const max = kind === 'json' ? MODULE_JSON_BODY_LIMIT : MAX_OBJECT_BYTES;
  return { kind, limit: count(body('limit'), max, `${at}/body/limit`) };
}

/**
 * The repository action and the parameter naming the repository: both or neither. A reading
 * route names a reading action; a writing route open to every authenticated caller must be held
 * to a writing action on a repository, so no module write is open to anyone signed in.
 */
function routeAccess(route: Row, params: readonly string[], effect: 'read' | 'write', at: string) {
  const access = oneOf(
    route('access'),
    ['authenticated', 'administrator'] as const,
    `${at}/access`,
  );
  const action =
    route('action') === null ? null : oneOf(route('action'), MODULE_ROUTE_ACTIONS, `${at}/action`);
  const parameter = route('repositoryParam');
  if (parameter !== null && (typeof parameter !== 'string' || !params.includes(parameter)))
    throw invalid(`${at}/repositoryParam`);
  if ((action === null) !== (parameter === null)) throw invalid(`${at}/action`);
  if (effect === 'read' && action !== null && !READING_ACTIONS.includes(action))
    throw invalid(`${at}/action`);
  if (
    effect === 'write' &&
    access === 'authenticated' &&
    (action === null || READING_ACTIONS.includes(action))
  )
    throw invalid(`${at}/action`);
  return { access, action, repositoryParam: parameter };
}

/**
 * Reads one route a module added, as untrusted input (module code is trusted because it is
 * signed, not because of its types). `GET` and `effect: 'read'` go together: reads are what a
 * read gateway serves, and a `GET` that changes state would be served there too.
 */
export function checkRoute(value: unknown, manifest: ModuleManifest, index: number): CheckedRoute {
  const at = `/routes/${String(index)}`;
  const route = row(value, at);
  const method = oneOf(route('method'), MODULE_ROUTE_METHODS, `${at}/method`);
  const { path, params } = routePath(route('path'), manifest, at);
  const operationId = route('operationId');
  if (
    typeof operationId !== 'string' ||
    !operationId.startsWith(`${manifest.id}.`) ||
    !/^[a-z][a-zA-Z0-9]{0,63}$/.test(operationId.slice(manifest.id.length + 1))
  )
    throw invalid(`${at}/operationId`);
  const effect = oneOf(route('effect'), ['read', 'write'] as const, `${at}/effect`);
  if ((method === 'GET') !== (effect === 'read')) throw invalid(`${at}/effect`);
  const body = routeBody(route('body'), at);
  if (method === 'GET' && body.kind !== 'none') throw invalid(`${at}/body`);
  const handle = route('handle');
  if (typeof handle !== 'function') throw invalid(`${at}/handle`);
  return {
    module: manifest.id,
    method,
    path,
    params,
    operationId,
    effect,
    ...routeAccess(route, params, effect, at),
    body,
    responseLimit: count(route('responseLimit'), Number.MAX_SAFE_INTEGER, `${at}/responseLimit`),
    timeoutMs: count(route('timeoutMs'), MODULE_ROUTE_TIMEOUT_LIMIT_MS, `${at}/timeoutMs`),
    // A synchronous throw becomes a rejection, like any failure of the handler.
    handle: (request, signal) =>
      Promise.resolve().then((): unknown => Reflect.apply(handle, value, [request, signal])),
  };
}

/** The router's notion of one path: parameters differ only by name. */
export const routeShape = (route: Pick<CheckedRoute, 'method' | 'path'>) =>
  `${route.method} ${route.path.replace(/:[a-zA-Z0-9]+/g, ':')}`;

/**
 * Every route of a module: at most `limit`, unique by operation and by path shape, and every
 * route prefix of the module served by at least one of them.
 */
export function checkRoutes(
  values: readonly unknown[],
  manifest: ModuleManifest,
  limit: number,
): CheckedRoute[] {
  if (values.length > limit) throw invalid('/routes');
  const routes = values.map((value, index) => checkRoute(value, manifest, index));
  routes.forEach((route, index) => {
    const earlier = routes.slice(0, index);
    if (earlier.some((other) => other.operationId === route.operationId))
      throw invalid(`/routes/${String(index)}/operationId`);
    if (earlier.some((other) => routeShape(other) === routeShape(route)))
      throw invalid(`/routes/${String(index)}/path`);
  });
  if (routes.length > 0 || manifest.routePrefixes.length > 0)
    manifest.routePrefixes.forEach((prefix, index) => {
      if (!routes.some((route) => route.path.startsWith(prefix)))
        throw invalid(`/routePrefixes/${String(index)}`);
    });
  return routes;
}

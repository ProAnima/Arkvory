import type { AccessScopes } from '@proanima/arkvory-infrastructure';
import { requestScope } from './extension-request-scope.js';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError, authorizeAction, requireAdministrator } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ModuleRequest, ModuleRequestBody } from '@proanima/arkvory-extension-api';
import { READING_ACTIONS, type CheckedRoute } from './extension-route-check.js';
import {
  answerOf,
  closeBody,
  immutableCaching,
  ModuleResponseError,
  sendAnswer,
  type ResponseServices,
} from './extension-responses.js';
import type { ProtocolTransfers } from './protocol-transfers.js';
import type { ModuleRouteSet } from './extension-registry.js';
import { UploadReceiver } from './upload-lifetime.js';

/** What module routes share with the core's own transfers. */
export interface ExtensionServices extends ProtocolTransfers, ResponseServices {
  readonly role: 'api' | 'reader';
  scopes(module: string): AccessScopes;
  /** The largest object of this server; a stream body never exceeds it. */
  readonly maxObjectBytes: number;
}

const MAX_QUERY_PARAMETERS = 32;
/** The only answer a module failure gets; the log keeps the module and the route. */
class ModuleRouteFailure extends Error {
  override readonly name = 'ModuleRouteFailure';
}

/**
 * The core's checks before any module code runs (ADR 0083, N7): the global administrator for
 * `access: 'administrator'`, and the route's action on the repository its parameter names, by
 * the rules of `/api/v1` (a service key by its permissions, an account by its read or write
 * grant, no change in a mirrored repository).
 */
function authorizeRoute(
  route: CheckedRoute,
  principal: Principal,
  params: Readonly<Record<string, string>>,
) {
  if (route.access === 'administrator') requireAdministrator(principal);
  if (route.action === null || route.repositoryParam === null) return;
  const legacy = READING_ACTIONS.includes(route.action)
    ? (['read'] as const)
    : (['write'] as const);
  authorizeAction(principal, params[route.repositoryParam] ?? '', route.action, legacy);
}

function textRecord(value: unknown, what: string): Record<string, string> {
  const entries = typeof value === 'object' && value !== null ? Object.entries(value) : [];
  if (entries.length > MAX_QUERY_PARAMETERS || entries.some(([, item]) => typeof item !== 'string'))
    throw new ArkvoryError('invalid_input', `Invalid ${what}`);
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}

/** A JSON body, parsed by the router within the route's limit; anything else is refused. */
function jsonBody(request: FastifyRequest): ModuleRequestBody {
  const type = request.headers['content-type'] ?? '';
  if (request.body instanceof Readable || !/^application\/json(;|$)/i.test(type))
    throw new ArkvoryError('invalid_input', 'Content-Type must be application/json', {
      reason: 'unsupported_media_type',
    });
  return { kind: 'json', value: request.body };
}

function plainBody(route: CheckedRoute, request: FastifyRequest): ModuleRequestBody {
  if (route.body.kind === 'json') return jsonBody(request);
  if (request.body !== undefined && request.body !== null)
    throw new ArkvoryError('invalid_input', 'This operation takes no request body');
  return { kind: 'none' };
}

/**
 * A stream body never longer than the route's limit: a declared length above it is refused
 * before the module reads a byte, a longer stream when it passes the limit.
 */
async function* limited(source: AsyncIterable<Uint8Array>, limit: number) {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > limit)
      throw new ArkvoryError('invalid_input', 'Request body is too large', {
        reason: 'body_too_large',
      });
    yield chunk;
  }
}

function declaredLength(request: FastifyRequest, limit: number): number | null {
  const header = request.headers['content-length'];
  if (header === undefined) return null;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(header))
    throw new ArkvoryError('invalid_input', 'Invalid Content-Length');
  const length = Number(header);
  if (length > limit)
    throw new ArkvoryError('invalid_input', 'Request body is too large', {
      reason: 'body_too_large',
    });
  return length;
}

/**
 * Calls the handler within the route's time. The handler's signal aborts with the request, at
 * the deadline and when the process stops; an answer that arrives too late is closed unread.
 * A throw of module code is a server error: logged with the module, answered `internal`.
 */
async function invoke(
  route: CheckedRoute,
  request: ModuleRequest,
  external: AbortSignal,
  services: ExtensionServices,
  http: FastifyRequest,
): Promise<unknown> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([external, deadline.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      services.scopes(route.module).revoke(request.scope);
      deadline.abort();
      reject(new ArkvoryError('unavailable', 'The module did not answer in time'));
    }, route.timeoutMs);
  });
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new ArkvoryError('unavailable', 'Module request cancelled'));
    };
    external.addEventListener('abort', abort, { once: true });
    if (external.aborted) abort();
  });
  const answer = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return route.handle(request, signal);
  });
  let returned = false;
  try {
    const value = await Promise.race([answer, expired, cancelled]);
    returned = true;
    return value;
  } catch (error) {
    if (error instanceof ArkvoryError || external.aborted) throw error;
    services.diagnostics.write({
      level: 'error',
      component: 'module',
      code: 'module.route_failed',
      module: route.module,
      requestId: http.id,
      route: route.path,
      method: http.method,
    });
    throw new ModuleRouteFailure('Module route failed');
  } finally {
    clearTimeout(timer);
    external.removeEventListener('abort', abort);
    // Only an answer the race did not return is closed here; a returned one belongs to the caller.
    if (!returned) void answer.then(closeBody, () => undefined);
  }
}

async function handleRoute(
  route: CheckedRoute,
  request: FastifyRequest,
  reply: FastifyReply,
  services: ExtensionServices,
  receiver: UploadReceiver,
): Promise<FastifyReply> {
  // Responses of modules are never documents a browser renders or runs (ADR 0082, 7.6).
  reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
  // The general hook already refused it; module code of a read gateway never sees a write.
  if (services.role === 'reader' && route.effect === 'write')
    throw new ArkvoryError('read_only', 'Read gateway does not accept mutations');
  const principal = services.principal(request);
  const params = textRecord(request.params, 'path parameters');
  authorizeRoute(route, principal, params);
  const lifetime = requestScope(
    services.scopes(route.module),
    principal,
    services.signal(request, reply),
    reply,
  );
  const external = lifetime.signal;
  const base = {
    method: request.method === 'HEAD' ? ('HEAD' as const) : route.method,
    params,
    query: textRecord(request.query, 'query'),
    requestId: request.id,
    scope: lifetime.scope,
  };
  const run = async (): Promise<unknown> => {
    if (route.body.kind !== 'stream')
      return invoke(
        route,
        { ...base, body: plainBody(route, request) },
        external,
        services,
        request,
      );
    const limit = Math.min(route.body.limit, services.maxObjectBytes);
    const length = declaredLength(request, limit);
    if (!(request.body instanceof Readable)) request.body = Readable.from([]);
    return receiver.receive(request, reply, principal.id, external, (source, signal) => {
      const body = { kind: 'stream' as const, length, bytes: limited(source, limit) };
      return invoke(route, { ...base, body }, signal, services, request);
    });
  };
  // Writes take a place of the upload admission, as every change of the core does.
  try {
    const value = route.effect === 'write' ? await services.modifying(request, run) : await run();
    let answer;
    try {
      answer = answerOf(value, route);
    } catch (error) {
      closeBody(value);
      if (!(error instanceof ModuleResponseError)) throw error;
      services.diagnostics.write({
        level: 'error',
        component: 'module',
        code: 'module.response_invalid',
        module: route.module,
        requestId: request.id,
        route: route.path,
        method: request.method,
      });
      throw new ModuleRouteFailure('Module answer outside the contract');
    }
    return await sendAnswer(answer, route, {
      request,
      reply,
      services,
      principal,
      signal: external,
    });
  } catch (error) {
    lifetime.revoke();
    throw error;
  }
}

/**
 * Registers the routes of running modules (ADR 0079, 5.2; ADR 0083, N7). A read gateway holds
 * the writing routes too, as it holds those of `/api/v1`: its general hook answers them
 * `read_only` after authentication, so a path without a reading route is not `not_found` there.
 * A `GET` route answers `HEAD`. Stream bodies are read in their own scope, where every media
 * type is bytes.
 */
export function registerExtensionRoutes(
  app: FastifyInstance,
  routes: readonly CheckedRoute[],
  services: ExtensionServices,
): void {
  const report = (request: FastifyRequest, code: 'upload.input_timeout' | 'upload.deadline') => {
    services.diagnostics.write({
      level: 'warning',
      component: 'http',
      code,
      requestId: request.id,
      route: request.routeOptions.url ?? 'unknown',
      method: request.method,
    });
  };
  const receiver = new UploadReceiver(services.policy, services.bandwidth, report);
  const add = (scope: FastifyInstance, route: CheckedRoute) => {
    scope.route({
      method: route.method === 'GET' ? ['GET', 'HEAD'] : route.method,
      url: route.path,
      ...(route.body.kind === 'json' ? { bodyLimit: route.body.limit } : {}),
      onSend: immutableCaching,
      handler: (request, reply) => handleRoute(route, request, reply, services, receiver),
    });
  };
  for (const route of routes.filter((r) => r.body.kind !== 'stream')) add(app, route);
  const streamed = routes.filter((r) => r.body.kind === 'stream');
  if (streamed.length > 0)
    void app.register((scope, _options, done) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', (_request, payload, parsed) => {
        parsed(null, payload);
      });
      for (const route of streamed) add(scope, route);
      done();
    });
}

/** The routes this process serves for each module, as the contract guard compares them. */
export function declaredRoutes(
  sets: readonly ModuleRouteSet[],
): ReadonlyMap<string, readonly { method: string; url: string }[]> {
  return new Map(
    sets.map((set) => [
      set.module,
      set.routes.map((route) => ({ method: route.method, url: route.path })),
    ]),
  );
}

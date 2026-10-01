import type { FastifyInstance } from 'fastify';
import type { RequestContext } from './request-context.js';
import { sendFailure } from './http-errors.js';

interface RoutePattern {
  readonly method: string;
  readonly pattern: RegExp;
}
const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** find-my-way syntax used by this API: `:name` is one segment, a trailing `*` the remainder. */
export function routePattern(url: string): RegExp {
  const source = url
    .split('/')
    .map((segment) =>
      segment === '*' ? '.*' : segment.startsWith(':') ? '[^/]+' : escapeLiteral(segment),
    )
    .join('/');
  return new RegExp(`^${source}$`);
}

/**
 * Unmatched requests get the native envelope before authentication, so the answer does not
 * depend on credentials and never echoes the URL. A path served under another method is 405
 * with Allow; the matcher only runs on misses, so routing of matched requests is unchanged.
 * A read gateway keeps its documented answer to mutations: read_only with Allow: GET, HEAD.
 */
export function registerNotFound(
  app: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
  role: 'api' | 'reader' = 'api',
): void {
  const routes: RoutePattern[] = [];
  app.addHook('onRoute', (options) => {
    for (const method of Array.isArray(options.method) ? options.method : [options.method])
      routes.push({ method: method.toUpperCase(), pattern: routePattern(options.url) });
  });
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const allowed = [
      ...new Set(routes.filter((r) => r.pattern.test(path)).map((r) => r.method)),
    ].sort();
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    if (allowed.length && role === 'reader' && mutation) {
      context.recordError(request, 'read_only');
      reply.header('Allow', 'GET, HEAD');
      return sendFailure(request, reply, {
        code: 'read_only',
        message: 'Read gateway does not accept mutations',
      });
    }
    if (allowed.length && !allowed.includes(request.method)) {
      context.recordError(request, 'invalid_input');
      reply.header('Allow', allowed.join(', '));
      return sendFailure(request, reply, {
        code: 'invalid_input',
        reason: 'method_not_allowed',
        message: 'Method not allowed for this path',
      });
    }
    context.recordError(request, 'not_found');
    return sendFailure(request, reply, {
      code: 'not_found',
      reason: 'route_not_found',
      message: 'No API operation at this path',
    });
  });
}

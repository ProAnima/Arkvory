import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequestContext } from './request-context.js';
import { clearStagedHeaders, httpFailure, httpStatus } from './http-errors.js';
import type { HttpFailure } from './http-failure.js';

/** npm registry routes (ADR 0066): the npm protocol, outside /api/v1. */
export const npmPrefix = '/npm/:repository/';
export const isNpm = (request: FastifyRequest) =>
  request.routeOptions.url?.startsWith(npmPrefix) === true;

/**
 * Arkvory's refusal as npm clients print it: the status line, then `error`. The code and the
 * request ID stay for support; no challenge is sent, since npm and Unity send their configured
 * token without one.
 */
export async function sendNpmFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: HttpFailure,
  status = httpStatus(failure),
): Promise<FastifyReply> {
  if (failure.retryAfterSeconds !== undefined)
    reply.header('Retry-After', String(failure.retryAfterSeconds));
  return reply
    .code(status)
    .header('Content-Type', 'application/json; charset=utf-8')
    .send({ error: failure.message, code: failure.code, request_id: request.id });
}

/** Errors of the npm scope, hooks included; metrics see Arkvory's code as for every route. */
export function registerNpmErrors(
  scope: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  scope.setErrorHandler((error, request, reply) => {
    clearStagedHeaders(reply);
    if (request.body instanceof Readable && !request.body.readableEnded)
      reply.header('Connection', 'close');
    const failure = httpFailure(error);
    context.recordError(request, failure.code, failure.cause);
    void sendNpmFailure(request, reply, failure);
  });
}

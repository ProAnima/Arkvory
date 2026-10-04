import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LfsError } from '@proanima/arkvory-domain';
import type { RequestContext } from './request-context.js';
import { clearStagedHeaders, httpFailure, httpStatus } from './http-errors.js';
import type { HttpFailure } from './http-failure.js';

/** Git LFS routes (ADR 0065): the protocol of git-lfs, outside /api/v1. */
export const lfsPrefix = '/lfs/:repository/';
export const isLfs = (request: FastifyRequest) =>
  request.routeOptions.url?.startsWith(lfsPrefix) === true;
export const lfsMediaType = 'application/vnd.git-lfs+json';
/** git-lfs reads LFS-Authenticate first; Basic carries the Arkvory key as the password. */
const challenge = 'Basic realm="Arkvory", charset="UTF-8"';

/** Arkvory's refusal in the git-lfs error document; status and message stay Arkvory's. */
export async function sendLfsFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: HttpFailure,
  status = httpStatus(failure),
): Promise<FastifyReply> {
  if (status === 401)
    reply.header('LFS-Authenticate', challenge).header('WWW-Authenticate', challenge);
  if (failure.retryAfterSeconds !== undefined)
    reply.header('Retry-After', String(failure.retryAfterSeconds));
  return reply
    .code(status)
    .header('Content-Type', lfsMediaType)
    .send({ message: failure.message, request_id: request.id });
}

/** Errors of the LFS scope, hooks included; metrics see Arkvory's code as for every route. */
export function registerLfsErrors(
  scope: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  scope.setErrorHandler((error, request, reply) => {
    clearStagedHeaders(reply);
    if (request.body instanceof Readable && !request.body.readableEnded)
      reply.header('Connection', 'close');
    if (error instanceof LfsError) {
      const failure: HttpFailure = {
        code:
          error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : 'invalid_input',
        message: error.message,
      };
      context.recordError(request, failure.code);
      void sendLfsFailure(request, reply, failure, error.status);
      return;
    }
    const failure = httpFailure(error);
    context.recordError(request, failure.code, failure.cause);
    void sendLfsFailure(request, reply, failure);
  });
}

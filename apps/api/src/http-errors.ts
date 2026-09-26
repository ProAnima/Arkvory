import type { FastifyInstance } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { RequestContext } from './request-context.js';

export function registerHttpErrors(
  app: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  app.setErrorHandler((error, request, reply) => {
    const codes = {
      invalid_input: 400,
      not_found: 404,
      conflict: 409,
      forbidden: 403,
      unauthorized: 401,
      capacity_exceeded: 507,
      integrity_mismatch: 422,
      busy: 503,
      unavailable: 503,
    } as const;
    if (error instanceof ArkvoryError) {
      context.recordError(request, error.code);
      if (error.code === 'busy' || error.code === 'unavailable') reply.header('Retry-After', '2');
      void reply
        .code(codes[error.code])
        .send({ code: error.code, message: error.message, requestId: request.id });
    } else {
      const clientError =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode >= 400 &&
        error.statusCode < 500;
      context.recordError(request, clientError ? 'invalid_input' : 'unavailable');
      void reply
        .code(clientError ? 400 : 503)
        .header('Retry-After', '2')
        .send({
          code: clientError ? 'invalid_input' : 'unavailable',
          message: clientError
            ? 'Invalid request'
            : 'Operation unavailable; query upload status before retrying',
          requestId: request.id,
        });
    }
  });
}

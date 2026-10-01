import type { FastifyInstance } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ErrorCode } from '@proanima/arkvory-domain';
import { classifyFailure, failureCause } from '@proanima/arkvory-infrastructure';
import type { FailureCause } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';

const statuses: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  capacity_exceeded: 507,
  integrity_mismatch: 422,
  busy: 503,
  unavailable: 503,
  internal: 500,
};
const stagedHeaders = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-range',
  'content-disposition',
  'accept-ranges',
  'etag',
  'last-modified',
];

interface HttpFailure {
  readonly code: ErrorCode;
  readonly message: string;
  /** Present only for failures that did not originate as a deliberate ArkvoryError. */
  readonly cause?: FailureCause;
}

/** Retry-After is promised only for transient states; a defect must not invite retry loops. */
export function httpFailure(error: unknown): HttpFailure {
  if (error instanceof ArkvoryError) return { code: error.code, message: error.message };
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? error.statusCode
      : undefined;
  if (typeof status === 'number' && status >= 400 && status < 500)
    return { code: 'invalid_input', message: 'Invalid request' };
  const cause = failureCause(error);
  switch (classifyFailure(error)) {
    case 'storage_full':
      return { code: 'capacity_exceeded', message: 'Storage capacity exhausted', cause };
    case 'cancelled':
      return { code: 'unavailable', message: 'Operation interrupted', cause };
    case 'dependency_unavailable':
      return {
        code: 'unavailable',
        message: 'Dependency temporarily unavailable; query upload status before retrying',
        cause,
      };
    case 'unexpected':
      return { code: 'internal', message: 'Internal server error', cause };
  }
}

export function registerHttpErrors(
  app: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  app.setErrorHandler((error, request, reply) => {
    // A stream can fail before its first byte after Fastify has staged headers on raw.
    // Clear both header stores so JSON errors cannot inherit the file's type or validators.
    for (const header of stagedHeaders) reply.removeHeader(header);
    const failure = httpFailure(error);
    // The cause is logged by ResponseDiagnostics; the client receives only the fixed message.
    context.recordError(request, failure.code, failure.cause);
    if (failure.code === 'busy' || failure.code === 'unavailable') reply.header('Retry-After', '2');
    void reply
      .code(statuses[failure.code])
      .send({ code: failure.code, message: failure.message, requestId: request.id });
  });
}

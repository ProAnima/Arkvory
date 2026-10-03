import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ErrorCode, ErrorReason } from '@proanima/arkvory-domain';
import { classifyFailure, failureCause } from '@proanima/arkvory-infrastructure';
import type { RequestContext } from './request-context.js';
import { frameworkFailure } from './framework-errors.js';
import type { HttpFailure } from './http-failure.js';
export type { HttpFailure } from './http-failure.js';

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
  rate_limited: 429,
  read_only: 405,
  internal: 500,
};
// Request-shape refinements of invalid_input keep their dedicated HTTP statuses (ADR 0051).
const inputStatuses: Partial<Record<ErrorReason, number>> = {
  body_too_large: 413,
  unsupported_media_type: 415,
  method_not_allowed: 405,
  range_not_satisfiable: 416,
};
/** Seconds announced for transient states that carry no explicit estimate. */
const defaultRetrySeconds = 2;
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

export function httpStatus(failure: Pick<HttpFailure, 'code' | 'reason'>): number {
  return (
    (failure.code === 'invalid_input' && failure.reason
      ? inputStatuses[failure.reason]
      : undefined) ?? statuses[failure.code]
  );
}

/** Retry-After is promised only for transient states; a defect must not invite retry loops. */
function retrySeconds(failure: HttpFailure): number | undefined {
  const transient = ['busy', 'unavailable', 'rate_limited'].includes(failure.code);
  return transient ? (failure.retryAfterSeconds ?? defaultRetrySeconds) : undefined;
}

function deliberate(error: ArkvoryError): HttpFailure {
  // Every input failure is a validation failure unless the thrower refined it further.
  const reason = error.reason ?? (error.code === 'invalid_input' ? 'validation' : undefined);
  return {
    code: error.code,
    message: error.message,
    ...(reason ? { reason } : {}),
    ...(error.details.length ? { details: error.details } : {}),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
  };
}

export function httpFailure(error: unknown): HttpFailure {
  if (error instanceof ArkvoryError) return deliberate(error);
  const framework = frameworkFailure(error);
  if (framework) return framework;
  const cause = failureCause(error);
  switch (classifyFailure(error)) {
    case 'storage_full':
      return {
        code: 'capacity_exceeded',
        reason: 'storage_full',
        message: 'Storage capacity exhausted',
        cause,
      };
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

/**
 * The single wire form of an error. `{code, message, requestId}` is the original contract;
 * reason, details and retryAfterSeconds are additive and omitted when unknown.
 */
export function errorBody(failure: HttpFailure, requestId: string) {
  const seconds = retrySeconds(failure);
  return {
    code: failure.code,
    message: failure.message,
    requestId,
    ...(failure.reason ? { reason: failure.reason } : {}),
    ...(failure.details?.length ? { details: failure.details } : {}),
    ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
  };
}

/** Sends a failure outside the error handler (hooks, 404/405) with the same envelope. */
export async function sendFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: HttpFailure,
): Promise<FastifyReply> {
  const body = errorBody(failure, request.id);
  if (body.retryAfterSeconds !== undefined)
    reply.header('Retry-After', String(body.retryAfterSeconds));
  return reply.code(httpStatus(failure)).send(body);
}

/** A stream can fail after Fastify staged its headers; an error must not inherit them. */
export function clearStagedHeaders(reply: FastifyReply): void {
  for (const header of stagedHeaders) reply.removeHeader(header);
}

export function registerHttpErrors(
  app: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  app.setErrorHandler((error, request, reply) => {
    // A stream can fail before its first byte after Fastify has staged headers on raw.
    // Clear both header stores so JSON errors cannot inherit the file's type or validators.
    clearStagedHeaders(reply);
    const failure = httpFailure(error);
    // The cause is logged by ResponseDiagnostics; the client receives only the fixed message.
    context.recordError(request, failure.code, failure.cause);
    void sendFailure(request, reply, failure);
  });
}

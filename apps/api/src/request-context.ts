import type { FastifyRequest, FastifyReply } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { FailureCause } from '@proanima/arkvory-infrastructure';

/** Request-local authority and cancellation; no process-global request state. */
export function createRequestContext(maxRequests = 128) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error('Invalid request budget');
  const principals = new WeakMap<FastifyRequest, Principal>();
  const requestSignals = new WeakMap<FastifyRequest, AbortSignal>();
  const errorCodes = new WeakMap<FastifyRequest, string>();
  const errorCauses = new WeakMap<FastifyRequest, FailureCause>();
  let requests = 0;
  const principal = (request: FastifyRequest): Principal => {
    const result = principals.get(request);
    if (!result)
      throw new ArkvoryError('forbidden', 'Authentication required', {
        reason: 'permission_missing',
      });
    return result;
  };
  const signal = (request: FastifyRequest, reply: FastifyReply): AbortSignal => {
    const existing = requestSignals.get(request);
    if (existing) return existing;
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    request.raw.once('aborted', abort);
    reply.raw.once('close', () => {
      request.raw.removeListener('aborted', abort);
      if (!reply.raw.writableFinished) abort();
    });
    if (request.raw.destroyed) abort();
    requestSignals.set(request, controller.signal);
    return controller.signal;
  };
  const countRequest = (reply: FastifyReply) => {
    if (requests >= maxRequests)
      throw new ArkvoryError('busy', 'Request capacity exceeded', { reason: 'request_limit' });
    requests++;
    let released = false;
    reply.raw.once('close', () => {
      if (!released) {
        requests--;
        released = true;
      }
    });
  };

  return {
    principal,
    signal,
    countRequest,
    // A per-request copy carries the correlation ID into scenarios, jobs and audit rows explicitly.
    authenticate: (request: FastifyRequest, value: Principal) => {
      principals.set(request, { ...value, requestId: request.id });
    },
    peekPrincipal: (request: FastifyRequest) => principals.get(request),
    requestSignal: (request: FastifyRequest) => requestSignals.get(request),
    errorCode: (request: FastifyRequest) => errorCodes.get(request),
    errorCause: (request: FastifyRequest) => errorCauses.get(request),
    recordError: (request: FastifyRequest, code: string, cause?: FailureCause) => {
      errorCodes.set(request, code);
      if (cause) errorCauses.set(request, cause);
    },
  };
}
export type RequestContext = ReturnType<typeof createRequestContext>;

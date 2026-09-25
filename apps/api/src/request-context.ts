import type { FastifyRequest, FastifyReply } from 'fastify';
import { DepotError } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';

/** Request-local authority and cancellation; no process-global request state. */
export function createRequestContext() {
  const principals = new WeakMap<FastifyRequest, Principal>();
  const requestSignals = new WeakMap<FastifyRequest, AbortSignal>();
  const errorCodes = new WeakMap<FastifyRequest, string>();
  let requests = 0;
  const principal = (request: FastifyRequest): Principal => {
    const result = principals.get(request);
    if (!result) throw new DepotError('forbidden', 'Authentication required');
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
    if (requests >= 128) throw new DepotError('busy', 'Request capacity exceeded');
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
    authenticate: (request: FastifyRequest, value: Principal) => {
      principals.set(request, value);
    },
    peekPrincipal: (request: FastifyRequest) => principals.get(request),
    requestSignal: (request: FastifyRequest) => requestSignals.get(request),
    errorCode: (request: FastifyRequest) => errorCodes.get(request),
    recordError: (request: FastifyRequest, code: string) => {
      errorCodes.set(request, code);
    },
  };
}
export type RequestContext = ReturnType<typeof createRequestContext>;

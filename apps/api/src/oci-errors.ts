import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OciError } from '@proanima/arkvory-domain';
import type { ErrorCode } from '@proanima/arkvory-domain';
import type { RequestContext } from './request-context.js';
import { clearStagedHeaders, httpFailure, httpStatus } from './http-errors.js';
import type { HttpFailure } from './http-failure.js';

/** The registry's routes (ADR 0063): the OCI Distribution API, outside /api/v1. */
export const registryRoute = '/v2/*';
export const isRegistry = (request: FastifyRequest) => request.routeOptions.url === registryRoute;
/** Docker learns the authentication scheme from this challenge, then sends the key as Basic. */
export const registryChallenge = 'Basic realm="Arkvory", charset="UTF-8"';
export const registryVersion = ['Docker-Distribution-API-Version', 'registry/2.0'] as const;

/** Docker sends the key as the Basic password; the user name is not checked. */
export function registryCredential(header: string | undefined): string {
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (!header?.startsWith('Basic ')) return '';
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon < 0 ? '' : decoded.slice(colon + 1);
}

const ociCodes: Record<ErrorCode, string> = {
  invalid_input: 'UNSUPPORTED',
  not_found: 'NAME_UNKNOWN',
  conflict: 'DENIED',
  forbidden: 'DENIED',
  unauthorized: 'UNAUTHORIZED',
  capacity_exceeded: 'DENIED',
  integrity_mismatch: 'DIGEST_INVALID',
  busy: 'TOOMANYREQUESTS',
  unavailable: 'UNAVAILABLE',
  rate_limited: 'TOOMANYREQUESTS',
  read_only: 'UNSUPPORTED',
  internal: 'UNKNOWN',
};
const inputCodes: Partial<Record<string, string>> = {
  body_too_large: 'SIZE_INVALID',
  range_not_satisfiable: 'BLOB_UPLOAD_INVALID',
};

/** Arkvory's own refusal in the registry's terms; status and message stay Arkvory's. */
export async function sendOciFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: HttpFailure,
  oci?: { readonly code: string; readonly status: number },
): Promise<FastifyReply> {
  const status = oci?.status ?? httpStatus(failure);
  const code =
    oci?.code ??
    (failure.reason ? inputCodes[failure.reason] : undefined) ??
    ociCodes[failure.code];
  if (status === 401) reply.header('WWW-Authenticate', registryChallenge);
  if (failure.retryAfterSeconds !== undefined)
    reply.header('Retry-After', String(failure.retryAfterSeconds));
  return reply
    .code(status)
    .header(...registryVersion)
    .header('Content-Type', 'application/json')
    .send({ errors: [{ code, message: failure.message, detail: { requestId: request.id } }] });
}

/**
 * Errors of the registry's scope, hooks included, in the OCI envelope. Metrics and diagnostics
 * see the Arkvory code, as for every other route.
 */
export function registerOciErrors(
  scope: FastifyInstance,
  context: Pick<RequestContext, 'recordError'>,
) {
  scope.setErrorHandler((error, request, reply) => {
    clearStagedHeaders(reply);
    // A refusal before the bytes were read must not leave them for the next request.
    if (request.body instanceof Readable && !request.body.readableEnded)
      reply.header('Connection', 'close');
    if (error instanceof OciError) {
      const failure: HttpFailure = {
        code: error.status === 404 ? 'not_found' : 'invalid_input',
        message: error.message,
      };
      context.recordError(request, failure.code);
      void sendOciFailure(request, reply, failure, { code: error.code, status: error.status });
      return;
    }
    const failure = httpFailure(error);
    context.recordError(request, failure.code, failure.cause);
    void sendOciFailure(request, reply, failure);
  });
}

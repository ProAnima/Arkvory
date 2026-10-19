import type { FastifyReply } from 'fastify';
import type { Principal } from '@proanima/arkvory-domain';
import type { AccessScopes } from '@proanima/arkvory-infrastructure';

/** The authority belongs to the HTTP response, including lazy response streams. */
export function requestScope(
  scopes: AccessScopes,
  principal: Principal,
  external: AbortSignal,
  reply: FastifyReply,
) {
  const scope = scopes.of([principal], [external]);
  const signal = scopes.signal(scope);
  const revoke = () => {
    scopes.revoke(scope);
  };
  const cleanup = () => {
    reply.raw.removeListener('finish', revoke);
    reply.raw.removeListener('close', revoke);
  };
  reply.raw.once('finish', revoke);
  reply.raw.once('close', revoke);
  signal.addEventListener('abort', cleanup, { once: true });
  if (signal.aborted) cleanup();
  return { scope, signal, revoke };
}

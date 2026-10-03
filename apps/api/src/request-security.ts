import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type {
  CredentialRejection,
  DownloadLinks,
  IdentityService,
} from '@proanima/arkvory-application';
import type { PostgresServices } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import type { RequestContext } from './request-context.js';
import { LoginAdmission } from './login-admission.js';
import type { RequestDrain } from './drain.js';
import { sendFailure } from './http-errors.js';

interface Security {
  config: Pick<ServerConfig, 'keys'>;
  role: 'api' | 'reader';
  available: () => boolean;
  identity: Pick<IdentityService, 'resolve' | 'rejection'>;
  serviceAccounts: Pick<PostgresServices, 'resolve' | 'rejection'>;
  links: Pick<DownloadLinks, 'principal' | 'rejection'>;
  context: Pick<RequestContext, 'signal' | 'countRequest' | 'authenticate'>;
  registerOwner: (id: string) => void;
  drain: Pick<RequestDrain, 'isDraining' | 'track'>;
}
/** Expiry is disclosed only to the holder of the exact credential; file keys never expire. */
async function rejection(
  { identity, serviceAccounts }: Pick<Security, 'identity' | 'serviceAccounts'>,
  token: string,
): Promise<CredentialRejection | 'credential_missing'> {
  if (!token) return 'credential_missing';
  if (token.length < 32 || token.length > 512) return 'credential_invalid';
  return token.startsWith('arkvory_')
    ? serviceAccounts.rejection(token)
    : identity.rejection(token);
}
const contentRoute = '/api/v1/repositories/:repository/artifacts/:id/content';
/**
 * A download link (ADR 0062): `?token=` on GET/HEAD of an artifact's content, without an
 * Authorization header. Anywhere else the parameter is not a credential.
 */
function linkOf(request: FastifyRequest): string | undefined {
  if (request.routeOptions.url !== contentRoute || request.headers.authorization) return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  const query: unknown = request.query;
  const token = query && typeof query === 'object' && 'token' in query ? query.token : undefined;
  return typeof token === 'string' ? token : undefined;
}
function pathOf(request: FastifyRequest): { repository: string; id: string } {
  const params: unknown = request.params;
  if (!params || typeof params !== 'object' || !('repository' in params) || !('id' in params))
    return { repository: '', id: '' };
  const { repository, id } = params;
  return {
    repository: typeof repository === 'string' ? repository : '',
    id: typeof id === 'string' ? id : '',
  };
}
/** Service key, file key, session or personal token from the Authorization header. */
async function bearerPrincipal(
  { config, identity, serviceAccounts }: Pick<Security, 'config' | 'identity' | 'serviceAccounts'>,
  token: string,
  activation: boolean,
): Promise<Principal | null> {
  // Digest and file-key comparison run for every token, as before, whatever its shape.
  const digest = createHash('sha256').update(token).digest();
  const key = token.startsWith('arkvory_')
    ? undefined
    : config.keys.find((candidate) =>
        timingSafeEqual(digest, Buffer.from(candidate.sha256, 'hex')),
      );
  if (token.length < 32 || token.length > 512) return null;
  if (token.startsWith('arkvory_')) return serviceAccounts.resolve(token, activation);
  return key ? { ...key.principal, credential: 'file-key' } : identity.resolve(token);
}
/** A download link authenticates its own artifact's content (ADR 0062); true when handled. */
async function linkRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  { links, context, registerOwner }: Pick<Security, 'links' | 'context' | 'registerOwner'>,
): Promise<boolean> {
  const link = linkOf(request);
  if (link === undefined) return false;
  const { repository, id } = pathOf(request);
  const holder = await links.principal(link, repository, id);
  if (!holder) {
    await sendFailure(request, reply, {
      code: 'unauthorized',
      message: 'Valid download link required',
      reason: await links.rejection(link),
    });
    return true;
  }
  context.authenticate(request, holder);
  registerOwner(holder.id);
  return true;
}
// Public probes manage their own availability answer and never touch credentials.
const publicPaths = new Set(['/health/live', '/health/status']);
export function registerRequestSecurity(app: FastifyInstance, dependencies: Security) {
  const { role, available, context, registerOwner, drain } = dependencies;
  const loginAdmission = new LoginAdmission();
  app.addHook('preValidation', (request, _reply, done) => {
    loginAdmission.bodyReceived(request);
    done();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Request-Id', request.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    const route = request.routeOptions.url ?? '';
    if (publicPaths.has(route) || route.startsWith('/console/')) return;
    // Unmatched URLs reach the not-found handler with the same answer for every caller.
    if (request.is404) return;
    const health = route.startsWith('/health/');
    if (!health) {
      if (drain.isDraining) {
        reply.header('Connection', 'close');
        throw new ArkvoryError('busy', 'Server is draining; retry later');
      }
      drain.track(reply.raw);
    }
    if (!available())
      throw new ArkvoryError(
        'unavailable',
        'Gateway ownership or download lease lost; restart the service',
      );
    context.signal(request, reply);
    // Public sign-in options let a console decide which forms to show before authentication.
    if (request.routeOptions.url === '/api/v1/auth/options') return;
    if (
      request.routeOptions.url === '/api/v1/auth/login' ||
      request.routeOptions.url === '/api/v1/auth/register'
    ) {
      if (role === 'reader')
        await reply.code(405).header('Allow', 'GET, HEAD').send({
          code: 'read_only',
          message: 'Read gateway does not accept mutations',
          requestId: request.id,
        });
      else loginAdmission.acquire(request, reply);
      return;
    }
    // Public login cannot consume the protected budget; session lookup remains bounded.
    // Health probes stay outside it so transfer load cannot flap a node out of the balancer.
    if (!health) context.countRequest(reply);
    if (await linkRequest(request, reply, dependencies)) return;
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const authenticated = await bearerPrincipal(
      dependencies,
      token,
      request.routeOptions.url === '/api/v1/auth/activate-key',
    );
    if (!authenticated) {
      reply.header('WWW-Authenticate', 'Bearer');
      await sendFailure(request, reply, {
        code: 'unauthorized',
        message: 'Valid service key required',
        reason: await rejection(dependencies, token),
      });
      return;
    }
    context.authenticate(request, authenticated);
    if (authenticated.id.startsWith('user:') || authenticated.managed) {
      registerOwner(authenticated.id);
    }
    if (role === 'reader' && request.method !== 'GET' && request.method !== 'HEAD') {
      await reply.code(405).header('Allow', 'GET, HEAD').send({
        code: 'read_only',
        message: 'Read gateway does not accept mutations',
        requestId: request.id,
      });
      return;
    }
    // Defence in depth: a read token has no write grants, and no mutation route accepts it.
    if (
      authenticated.tokenScope === 'read' &&
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.routeOptions.url !== '/api/v1/auth/logout'
    ) {
      await sendFailure(request, reply, {
        code: 'forbidden',
        message: 'Read-only personal access token',
        reason: 'read_only_token',
      });
      return;
    }
  });
}

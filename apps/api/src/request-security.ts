import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { IdentityService } from '@proanima/arkvory-application';
import type { PostgresServices } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import type { RequestContext } from './request-context.js';
import { LoginAdmission } from './login-admission.js';

interface Security {
  config: Pick<ServerConfig, 'keys'>;
  role: 'api' | 'reader';
  available: () => boolean;
  identity: Pick<IdentityService, 'resolve'>;
  serviceAccounts: Pick<PostgresServices, 'resolve'>;
  context: Pick<RequestContext, 'signal' | 'countRequest' | 'authenticate'>;
  registerOwner: (id: string) => void;
}
export function registerRequestSecurity(app: FastifyInstance, dependencies: Security) {
  const { config, role, available, identity, serviceAccounts, context, registerOwner } =
    dependencies;
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
    if (
      request.routeOptions.url === '/health/live' ||
      request.routeOptions.url?.startsWith('/console/')
    )
      return;
    if (!available())
      throw new ArkvoryError(
        'unavailable',
        'Gateway ownership or download lease lost; restart the service',
      );
    context.signal(request, reply);
    if (request.routeOptions.url === '/api/v1/auth/login') {
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
    context.countRequest(reply);
    const auth = request.headers.authorization;
    const legacy =
      request.url.startsWith('/upack/') ||
      request.url.startsWith('/endpoints/') ||
      request.url.startsWith('/api/packages/');
    let token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (legacy && typeof request.headers['x-apikey'] === 'string')
      token = request.headers['x-apikey'];
    if (legacy && auth?.startsWith('Basic ')) {
      const basic = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      if (basic.startsWith('api:')) token = basic.slice(4);
    }
    const digest = createHash('sha256').update(token).digest();
    const key = token.startsWith('dpk_')
      ? undefined
      : config.keys.find((candidate) =>
          timingSafeEqual(digest, Buffer.from(candidate.sha256, 'hex')),
        );
    const authenticated =
      token.length >= 32 && token.length <= 512
        ? token.startsWith('dpk_')
          ? await serviceAccounts.resolve(
              token,
              request.routeOptions.url === '/api/v1/auth/activate-key',
            )
          : (key?.principal ?? (await identity.resolve(token)))
        : null;
    if (!authenticated) {
      await reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        code: 'unauthorized',
        message: 'Valid service key required',
        requestId: request.id,
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
  });
}

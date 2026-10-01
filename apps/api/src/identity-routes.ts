import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ThrottledError, requireId } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { IdentityService } from '@proanima/arkvory-application';
import type { AdmissionQueue } from '@proanima/arkvory-infrastructure';
import { clientKey } from './auth-throttle.js';
import type { AuthThrottle } from './auth-throttle.js';
import { fields } from './body-fields.js';
import { registerAccountRoutes } from './account-routes.js';
import type { PasswordWork } from './account-routes.js';

export interface IdentityRouteDependencies {
  service: IdentityService;
  principal: (request: FastifyRequest) => Principal;
  signal: (request: FastifyRequest, reply: FastifyReply) => AbortSignal;
  /** Anonymous login and registration hashing, round-robin per client address. */
  anonymousGate: AdmissionQueue;
  /** Authenticated password work keeps its own slot while anonymous logins flood. */
  accountGate: AdmissionQueue;
  throttle: AuthThrottle;
}

export function registerIdentityRoutes(app: FastifyInstance, routes: IdentityRouteDependencies) {
  const work =
    (gate: AdmissionQueue): PasswordWork =>
    async (request, reply, owner, action) => {
      const release = await gate.acquire(owner, routes.signal(request, reply));
      try {
        return await action();
      } finally {
        release();
      }
    };
  registerPublicRoutes(app, routes, work(routes.anonymousGate));
  registerSelfRoutes(app, routes, work(routes.accountGate));
  registerAccountRoutes(app, routes.service, routes.principal, work(routes.accountGate));
}

function registerPublicRoutes(
  app: FastifyInstance,
  { service, throttle }: IdentityRouteDependencies,
  passwordWork: PasswordWork,
): void {
  app.get('/api/v1/auth/options', () =>
    Promise.resolve({ selfRegistration: service.allowRegistration }),
  );
  // ThrottledError reaches the shared error handler: 429 rate_limited with Retry-After.
  app.post<{ Body: unknown }>('/api/v1/auth/login', async (request, reply) => {
    const body = fields(request.body, ['name', 'password'], { required: ['name', 'password'] });
    const address = clientKey(request.ip);
    const wait = throttle.admitLogin(address);
    if (wait) throw new ThrottledError(wait, 'login_attempts');
    const session = await passwordWork(request, reply, address, () =>
      service.login(body['name'], body['password'], request.ip, request.id),
    );
    throttle.loginSucceeded(address);
    return session;
  });
  app.post<{ Body: unknown }>('/api/v1/auth/register', async (request, reply) => {
    const body = fields(request.body, ['name', 'password'], { required: ['name', 'password'] });
    const address = clientKey(request.ip);
    // Disabled registration answers 403 below without spending anyone's budget.
    const wait = service.allowRegistration ? throttle.admitRegistration(address) : 0;
    if (wait) throw new ThrottledError(wait, 'registration_attempts');
    const session = await passwordWork(request, reply, address, () =>
      service.register(body['name'], body['password'], request.ip, request.id),
    );
    return reply.code(201).send(session);
  });
}

function registerSelfRoutes(
  app: FastifyInstance,
  { service, principal }: IdentityRouteDependencies,
  passwordWork: PasswordWork,
): void {
  app.get('/api/v1/auth/tokens', async (request) => ({
    items: await service.tokens(principal(request), request.ip),
  }));
  app.post<{ Body: unknown }>('/api/v1/auth/tokens', async (request, reply) => {
    const body = fields(request.body, ['name', 'expiresAt', 'scope']);
    const created = await service.createToken(
      principal(request),
      { name: body['name'], expiresAt: body['expiresAt'], scope: body['scope'] },
      request.ip,
    );
    return reply.code(201).send(created);
  });
  app.delete<{ Params: { id: string } }>('/api/v1/auth/tokens/:id', async (request, reply) => {
    await service.revokeToken(principal(request), requireId(request.params.id), request.ip);
    return reply.code(204).send();
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) await service.logout(auth.slice(7));
    return reply.code(204).send();
  });
  app.post<{ Body: unknown }>('/api/v1/auth/password', async (request, reply) => {
    const body = fields(request.body, ['currentPassword', 'newPassword'], {
      required: ['currentPassword', 'newPassword'],
    });
    const caller = principal(request);
    await passwordWork(request, reply, caller.id, () =>
      service.changePassword(caller, body['currentPassword'], body['newPassword'], request.ip),
    );
    return reply.code(204).send();
  });
  app.get('/api/v1/auth/me', (request) => {
    const p = principal(request);
    const grants = new Map<string, Set<'read' | 'write'>>();
    for (const grant of p.grants ??
      p.repositories.map((repository) => ({ repository, permissions: p.permissions }))) {
      if (grant.permissions.length === 0) continue;
      const permissions = grants.get(grant.repository) ?? new Set<'read' | 'write'>();
      for (const permission of grant.permissions) permissions.add(permission);
      grants.set(grant.repository, permissions);
    }
    return Promise.resolve({
      id: p.id,
      administrator: p.administrator ?? false,
      credential: p.credential,
      ...(p.tokenScope ? { tokenScope: p.tokenScope } : {}),
      grants: [...grants]
        .map(([repository, permissions]) => ({ repository, permissions: [...permissions] }))
        .sort((left, right) => left.repository.localeCompare(right.repository)),
    });
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { IdentityService } from '@proanima/arkvory-application';
import type { AdmissionQueue } from '@proanima/arkvory-infrastructure';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Expected an object');
  return Object.fromEntries(Object.entries(value));
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const body = object(value);
  if (Object.keys(body).some((key) => !names.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown field');
  return body;
}
export function registerIdentityRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
  loginGate: AdmissionQueue,
  signal: (request: FastifyRequest, reply: FastifyReply) => AbortSignal,
): void {
  const passwordWork = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T>,
  ): Promise<T> => {
    const release = await loginGate.acquire('password', signal(request, reply));
    try {
      return await action();
    } finally {
      release();
    }
  };
  registerAuthRoutes(app, service, principal, passwordWork);
  registerUserRoutes(app, service, principal, passwordWork);
  registerGroupRoutes(app, service, principal);
}

function registerAuthRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
  passwordWork: <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T>,
  ) => Promise<T>,
): void {
  app.post<{ Body: unknown }>('/api/v1/auth/login', async (request, reply) => {
    const body = fields(request.body, ['name', 'password']);
    return passwordWork(request, reply, () => service.login(body['name'], body['password']));
  });
  app.post<{ Body: unknown }>('/api/v1/auth/register', async (request, reply) => {
    const body = fields(request.body, ['name', 'password']);
    return reply
      .code(201)
      .send(
        await passwordWork(request, reply, () => service.register(body['name'], body['password'])),
      );
  });
  app.get('/api/v1/auth/tokens', async (request) => ({
    items: await service.tokens(principal(request)),
  }));
  app.post<{ Body: unknown }>('/api/v1/auth/tokens', async (request, reply) => {
    const body = fields(request.body, ['name', 'expiresAt']);
    return reply
      .code(201)
      .send(await service.createToken(principal(request), body['name'], body['expiresAt']));
  });
  app.delete<{ Params: { id: string } }>('/api/v1/auth/tokens/:id', async (request, reply) => {
    await service.revokeToken(principal(request), requireId(request.params.id));
    return reply.code(204).send();
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) await service.logout(auth.slice(7));
    return reply.code(204).send();
  });
  app.post<{ Body: unknown }>('/api/v1/auth/password', async (request, reply) => {
    const body = fields(request.body, ['currentPassword', 'newPassword']);
    await passwordWork(request, reply, async () => {
      await service.changePassword(
        principal(request),
        body['currentPassword'],
        body['newPassword'],
      );
    });
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
      grants: [...grants]
        .map(([repository, permissions]) => ({ repository, permissions: [...permissions] }))
        .sort((left, right) => left.repository.localeCompare(right.repository)),
    });
  });
}

function registerUserRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
  passwordWork: <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T>,
  ) => Promise<T>,
): void {
  app.post<{ Body: unknown }>('/api/v1/users', async (request, reply) => {
    const body = fields(request.body, ['name', 'password', 'administrator']);
    return reply
      .code(201)
      .send(
        await passwordWork(request, reply, () =>
          service.createUser(
            principal(request),
            body['name'],
            body['password'],
            body['administrator'] ?? false,
          ),
        ),
      );
  });
  app.get('/api/v1/users', async (request) => ({ items: await service.users(principal(request)) }));
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/users/:id',
    async (request, reply) =>
      passwordWork(request, reply, () =>
        service.updateUser(principal(request), requireId(request.params.id), request.body),
      ),
  );
}

function registerGroupRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
): void {
  app.post<{ Body: unknown }>('/api/v1/access-groups', async (request, reply) => {
    const body = fields(request.body, ['name']);
    return reply.code(201).send(await service.createGroup(principal(request), body['name']));
  });
  app.get('/api/v1/access-groups', async (request) => ({
    items: await service.groups(principal(request)),
  }));
  app.route<{ Params: { id: string; userId: string } }>({
    method: ['PUT', 'DELETE'],
    url: '/api/v1/access-groups/:id/members/:userId',
    handler: async (request, reply) => {
      await service.membership(
        principal(request),
        requireId(request.params.id),
        requireId(request.params.userId),
        request.method === 'PUT',
      );
      return reply.code(204).send();
    },
  });
  app.route<{ Params: { id: string; repository: string }; Body: unknown }>({
    method: ['PUT', 'DELETE'],
    url: '/api/v1/access-groups/:id/grants/:repository',
    handler: async (request, reply) => {
      const access =
        request.method === 'DELETE' ? null : fields(request.body, ['access'])['access'];
      await service.grant(
        principal(request),
        requireId(request.params.id),
        request.params.repository,
        access,
      );
      return reply.code(204).send();
    },
  });
}

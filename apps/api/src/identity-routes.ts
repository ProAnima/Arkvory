import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DepotError, requireId } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import type { IdentityService } from '@proanima/depot-application';
import type { AdmissionQueue } from '@proanima/depot-infrastructure';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Expected an object');
  return Object.fromEntries(Object.entries(value));
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const body = object(value);
  if (Object.keys(body).some((key) => !names.includes(key)))
    throw new DepotError('invalid_input', 'Unknown field');
  return body;
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
  loginGate: AdmissionQueue,
  signal: (request: FastifyRequest, reply: FastifyReply) => AbortSignal,
): void {
  app.post<{ Body: unknown }>('/api/v1/auth/login', async (request, reply) => {
    const body = fields(request.body, ['name', 'password']);
    const release = await loginGate.acquire('login', signal(request, reply));
    try {
      return await service.login(body['name'], body['password']);
    } finally {
      release();
    }
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) await service.logout(auth.slice(7));
    return reply.code(204).send();
  });
  app.post<{ Body: unknown }>('/api/v1/auth/password', async (request, reply) => {
    const body = fields(request.body, ['currentPassword', 'newPassword']);
    const release = await loginGate.acquire(principal(request).id, signal(request, reply));
    try {
      await service.changePassword(
        principal(request),
        body['currentPassword'],
        body['newPassword'],
      );
      return await reply.code(204).send();
    } finally {
      release();
    }
  });
  app.get('/api/v1/auth/me', (request) => {
    const p = principal(request);
    return Promise.resolve({
      id: p.id,
      administrator: p.administrator ?? false,
      grants:
        p.grants ??
        p.repositories.map((repository) => ({ repository, permissions: p.permissions })),
    });
  });
  app.post<{ Body: unknown }>('/api/v1/users', async (request, reply) => {
    const body = fields(request.body, ['name', 'password', 'administrator']);
    return reply
      .code(201)
      .send(
        await service.createUser(
          principal(request),
          body['name'],
          body['password'],
          body['administrator'] ?? false,
        ),
      );
  });
  app.get('/api/v1/users', async (request) => ({ items: await service.users(principal(request)) }));
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/v1/users/:id', async (request) =>
    service.updateUser(principal(request), requireId(request.params.id), request.body),
  );
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

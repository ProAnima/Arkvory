import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireId } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { IdentityService } from '@proanima/arkvory-application';
import { fields } from './body-fields.js';

/** Runs password hashing inside a bounded admission gate, fair per `owner`. */
export type PasswordWork = <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  owner: string,
  action: () => Promise<T>,
) => Promise<T>;

/** Account administration; the service rejects personal tokens and managed keys. */
export function registerAccountRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
  passwordWork: PasswordWork,
): void {
  app.post<{ Body: unknown }>('/api/v1/users', async (request, reply) => {
    const body = fields(request.body, ['name', 'password', 'administrator'], {
      required: ['name', 'password'],
    });
    const caller = principal(request);
    const account = await passwordWork(request, reply, caller.id, () =>
      service.createUser(
        caller,
        body['name'],
        body['password'],
        body['administrator'] ?? false,
        request.ip,
      ),
    );
    return reply.code(201).send(account);
  });
  app.get('/api/v1/users', async (request) => ({ items: await service.users(principal(request)) }));
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/users/:id',
    async (request, reply) => {
      const caller = principal(request);
      return passwordWork(request, reply, caller.id, () =>
        service.updateUser(caller, requireId(request.params.id), request.body, request.ip),
      );
    },
  );
  app.get<{ Params: { id: string } }>('/api/v1/users/:id/tokens', async (request) => ({
    items: await service.accountTokens(principal(request), requireId(request.params.id)),
  }));
  app.delete<{ Params: { id: string; tokenId: string } }>(
    '/api/v1/users/:id/tokens/:tokenId',
    async (request, reply) => {
      await service.revokeAccountToken(
        principal(request),
        requireId(request.params.id),
        requireId(request.params.tokenId),
        request.ip,
      );
      return reply.code(204).send();
    },
  );
  app.get<{ Querystring: unknown }>('/api/v1/security/audit', async (request) => {
    const query = fields(request.query ?? {}, ['after', 'limit'], { in: 'query' });
    return service.securityAudit(principal(request), query['after'], query['limit']);
  });
  registerGroupRoutes(app, service, principal);
}

function registerGroupRoutes(
  app: FastifyInstance,
  service: IdentityService,
  principal: (request: FastifyRequest) => Principal,
): void {
  app.post<{ Body: unknown }>('/api/v1/access-groups', async (request, reply) => {
    const body = fields(request.body, ['name'], { required: ['name'] });
    return reply
      .code(201)
      .send(await service.createGroup(principal(request), body['name'], request.ip));
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
        request.ip,
      );
      return reply.code(204).send();
    },
  });
  app.route<{ Params: { id: string; repository: string }; Body: unknown }>({
    method: ['PUT', 'DELETE'],
    url: '/api/v1/access-groups/:id/grants/:repository',
    handler: async (request, reply) => {
      const access =
        request.method === 'DELETE'
          ? null
          : fields(request.body, ['access'], { required: ['access'] })['access'];
      await service.grant(
        principal(request),
        requireId(request.params.id),
        request.params.repository,
        access,
        request.ip,
      );
      return reply.code(204).send();
    },
  });
}

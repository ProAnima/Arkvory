import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DepotError, MAX_OBJECT_BYTES, PART_BYTES } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import { effectivePermissions } from '@proanima/depot-application';
import type { ServiceAccess } from '@proanima/depot-application';

export function registerServiceRoutes(
  app: FastifyInstance,
  service: ServiceAccess,
  principal: (request: FastifyRequest) => Principal,
  role: 'api' | 'reader',
): void {
  type Params = { id: string };
  const after = (request: FastifyRequest) => {
    const q = request.query;
    if (typeof q !== 'object' || q === null) throw new DepotError('invalid_input', 'Invalid query');
    const values: Record<string, unknown> = Object.fromEntries(Object.entries(q));
    if (
      Object.keys(values).some((k) => k !== 'after') ||
      (values['after'] !== undefined && typeof values['after'] !== 'string')
    )
      throw new DepotError('invalid_input', 'Invalid cursor');
    return values['after'];
  };
  app.get('/api/v1/capabilities', () =>
    Promise.resolve({
      apiVersions: ['v1'],
      gatewayRole: role,
      features: {
        managedServiceKeys: true,
        delegatedServiceAdministration: true,
        assetPagination: true,
        repositoryDiscovery: true,
        operationDiscovery: true,
        apiSurfaces: true,
        repositoryPermissions: true,
        namespacePermissions: false,
        webhooks: false,
        replicatedStorage: false,
      },
      limits: { maxObjectBytes: String(MAX_OBJECT_BYTES), partBytes: PART_BYTES, maxPageSize: 100 },
    }),
  );
  app.get('/api/v1/auth/permissions', (request) => {
    const p = principal(request);
    return Promise.resolve({
      id: p.id,
      profile: p.managed ? 'managed' : 'legacy',
      credentialId: p.managed?.keyId ?? null,
      bindings: effectivePermissions(p),
      serviceAdministration: p.serviceAdministrator === true && !p.managed,
    });
  });
  app.get('/api/v1/service-accounts', (r) => service.accounts(principal(r), after(r)));
  app.post('/api/v1/service-accounts', async (r, reply) =>
    reply.code(201).send(await service.create(principal(r), r.body)),
  );
  app.get<{ Params: Params }>('/api/v1/service-accounts/:id', (r) =>
    service.account(principal(r), r.params.id),
  );
  app.patch<{ Params: Params }>('/api/v1/service-accounts/:id', (r) =>
    service.update(principal(r), r.params.id, r.body),
  );
  app.get<{ Params: Params }>('/api/v1/service-accounts/:id/policy', (r) =>
    service.account(principal(r), r.params.id, true),
  );
  app.put<{ Params: Params }>('/api/v1/service-accounts/:id/policy', (r) =>
    service.policy(principal(r), r.params.id, r.body),
  );
  app.get<{ Params: Params }>('/api/v1/service-accounts/:id/keys', (r) =>
    service.keys(principal(r), r.params.id, after(r)),
  );
  app.post<{ Params: Params }>('/api/v1/service-accounts/:id/keys', async (r, reply) => {
    const result = await service.issue(
      principal(r),
      r.params.id,
      r.headers['idempotency-key'],
      r.body,
    );
    return reply.code(result.secret ? 201 : 200).send(result);
  });
  app.get<{ Params: Params }>('/api/v1/api-keys/:id', (r) =>
    service.key(principal(r), r.params.id),
  );
  app.post<{ Params: Params }>('/api/v1/api-keys/:id/rotate', async (r, reply) => {
    const result = await service.issue(
      principal(r),
      r.params.id,
      r.headers['idempotency-key'],
      r.body,
      true,
    );
    return reply.code(result.secret ? 201 : 200).send(result);
  });
  app.post<{ Params: Params }>('/api/v1/api-keys/:id/revoke', async (r, reply) => {
    await service.revoke(principal(r), r.params.id);
    return reply.code(204).send();
  });
  app.post('/api/v1/auth/activate-key', async (r, reply) => {
    const auth = r.headers.authorization;
    if (!auth?.startsWith('Bearer dpk_'))
      throw new DepotError('unauthorized', 'Managed Bearer key required');
    await service.activate(auth.slice(7));
    return reply.code(204).send();
  });
  app.get<{ Params: Params }>('/api/v1/service-accounts/:id/audit', async (r) => ({
    items: await service.audit(principal(r), r.params.id, after(r)),
  }));
  app.get<{ Params: Params }>('/api/v1/api-keys/:id/delegations', async (r) => ({
    items: await service.delegations(principal(r), r.params.id),
  }));
  app.put<{ Params: Params & { accountId: string } }>(
    '/api/v1/api-keys/:id/delegations/:accountId',
    (r) => service.setDelegation(principal(r), r.params.id, r.params.accountId, r.body),
  );
  app.delete<{ Params: Params & { accountId: string } }>(
    '/api/v1/api-keys/:id/delegations/:accountId',
    (r) => service.removeDelegation(principal(r), r.params.id, r.params.accountId, r.body),
  );
}

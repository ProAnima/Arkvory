import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, MAX_PARTS, MAX_PART_BYTES, PART_BYTES } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { effectivePermissions } from '@proanima/arkvory-application';
import type { ServiceAccess } from '@proanima/arkvory-application';

function after(request: FastifyRequest) {
  const q = request.query;
  if (typeof q !== 'object' || q === null) throw new ArkvoryError('invalid_input', 'Invalid query');
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(q));
  if (
    Object.keys(values).some((k) => k !== 'after') ||
    (values['after'] !== undefined && typeof values['after'] !== 'string')
  )
    throw new ArkvoryError('invalid_input', 'Invalid cursor');
  return values['after'];
}
export function registerServiceRoutes(
  app: FastifyInstance,
  service: ServiceAccess,
  principal: (request: FastifyRequest) => Principal,
  role: 'api' | 'reader',
  {
    maxObjectBytes,
    selfRegistration,
    modules,
    transfer,
  }: {
    maxObjectBytes: number;
    selfRegistration: boolean;
    /** Enabled modules this gateway runs (ADR 0079, section 9), in id order. */
    modules: readonly { readonly id: string; readonly kind: string }[];
    /** Transfer protocols of the running modules (ADR 0079, 5.2), in module order. */
    transfer: readonly {
      readonly name: string;
      readonly versions: readonly string[];
      readonly module: string;
      readonly prefix: string;
    }[];
  },
): void {
  app.get('/api/v1/capabilities', () =>
    Promise.resolve({
      apiVersions: ['v1'],
      gatewayRole: role,
      features: {
        managedServiceKeys: true,
        delegatedServiceAdministration: true,
        assetPagination: true,
        repositoryDiscovery: true,
        buildAttachments: true,
        artifactDeletion: true,
        retentionPreview: true,
        onlineGarbageCollection: true,
        operationDiscovery: true,
        apiSurfaces: true,
        repositoryPermissions: true,
        personalAccessTokens: true,
        selfRegistration,
        securityAudit: true,
        namespacePermissions: false,
        webhooks: false,
        replicatedStorage: false,
        // A source a mirror can follow (ADR 0058): GET repositories/{r}/changes.
        mirrorFeed: true,
        // The installation's event feed (ADR 0080): GET /api/v1/events and /events/types.
        events: true,
      },
      limits: {
        maxObjectBytes: String(maxObjectBytes),
        partBytes: PART_BYTES,
        maxPartBytes: MAX_PART_BYTES,
        maxParts: MAX_PARTS,
        maxPageSize: 100,
      },
      modules: modules.map(({ id, kind }) => ({ id, kind })),
      transfer: transfer.map(({ name, versions, module, prefix }) => ({
        name,
        versions,
        module,
        prefix,
      })),
      // ADR 0083, N8: the archive table of contents route of the core (`zip-tree` version 1).
      tree: [{ name: 'zip-tree', versions: ['1.0.0'], module: 'core', prefix: '/api/v1/' }],
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
  registerServiceAccountRoutes(app, service, principal);
  registerServiceKeyRoutes(app, service, principal);
}

type Params = { id: string };

function registerServiceAccountRoutes(
  app: FastifyInstance,
  service: ServiceAccess,
  principal: (request: FastifyRequest) => Principal,
): void {
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
  app.get<{ Params: Params }>('/api/v1/service-accounts/:id/audit', async (r) => ({
    items: await service.audit(principal(r), r.params.id, after(r)),
  }));
}

function registerServiceKeyRoutes(
  app: FastifyInstance,
  service: ServiceAccess,
  principal: (request: FastifyRequest) => Principal,
): void {
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
    if (!auth?.startsWith('Bearer arkvory_'))
      throw new ArkvoryError('unauthorized', 'Managed Bearer key required', {
        reason: 'credential_invalid',
      });
    await service.activate(auth.slice(7));
    return reply.code(204).send();
  });
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

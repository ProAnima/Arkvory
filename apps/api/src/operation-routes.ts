import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DepotError, requireRepository } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import { effectivePermissions, operationVisible } from '@proanima/depot-application';
import type { ServiceAccess } from '@proanima/depot-application';
import {
  apiOperations,
  apiSurfaces,
  openApiDocument,
  openApiSurface,
} from '@proanima/depot-contracts';
import type {
  OperationDescriptor,
  OperationPage,
  OperationCondition,
  ApiSurface,
} from '@proanima/depot-contracts';

function query(input: unknown, allowed: readonly string[]): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DepotError('invalid_input', 'Invalid API discovery query');
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || typeof value !== 'string')
      throw new DepotError('invalid_input', 'Unknown or repeated API discovery option');
    values[key] = value;
  }
  return values;
}
function surface(input: unknown): ApiSurface | undefined {
  if (input === undefined) return undefined;
  const found = apiSurfaces.find((value) => value === input);
  if (!found) throw new DepotError('invalid_input', 'Unknown API surface');
  return found;
}
export function registerOperationRoutes(
  app: FastifyInstance,
  service: ServiceAccess,
  principal: (request: FastifyRequest) => Principal,
  role: 'api' | 'reader',
) {
  app.get('/api/v1/openapi.json', (request, reply) => {
    const values = query(request.query, ['surface']);
    const selected = surface(values['surface']);
    return reply
      .header('Cache-Control', 'private, no-store')
      .send(selected ? openApiSurface(selected) : openApiDocument);
  });
  app.get('/api/v1/operations', async (request, reply): Promise<OperationPage> => {
    const q = query(request.query, ['repository', 'surface', 'after', 'limit']);
    const repository =
      q['repository'] === undefined ? undefined : requireRepository(q['repository']);
    const selected = surface(q['surface']);
    const after = q['after'];
    if (
      after !== undefined &&
      (typeof after !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(after))
    )
      throw new DepotError('invalid_input', 'Invalid operation cursor');
    const rawLimit = q['limit'];
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== 'string' ||
        !/^[1-9][0-9]{0,2}$/.test(rawLimit) ||
        Number(rawLimit) > 100)
    )
      throw new DepotError('invalid_input', 'Invalid page limit');
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    const actor = principal(request);
    if (
      repository &&
      !effectivePermissions(actor).some(
        (binding) => binding.resource.id === repository && binding.actions.length,
      )
    )
      throw new DepotError('not_found', 'Repository scope not found');
    const delegations = actor.managed ? await service.delegations(actor, actor.managed.keyId) : [];
    const bootstrap = !actor.managed && actor.serviceAdministrator === true;
    const items: OperationDescriptor[] = [];
    for (const operation of apiOperations) {
      if (selected && operation.surface !== selected) continue;
      if (role === 'reader' && operation.method !== 'get' && operation.method !== 'head') continue;
      if (!operationVisible(actor, operation.access, repository, delegations)) continue;
      const access = operation.access;
      const conditions: OperationCondition[] = [];
      if (access.kind === 'repository') {
        conditions.push('resource-state');
        if (access.owner) conditions.push(`${access.owner}-owner`);
      }
      if (access.kind === 'service-administration' && !bootstrap)
        conditions.push('delegation-target-and-ceiling');
      if (access.kind === 'bootstrap-or-own-key' && !bootstrap) conditions.push('own-key');
      items.push({
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        summary: operation.summary,
        surface: operation.surface,
        visibility: operation.visibility,
        retry: operation.retry,
        conditions,
        requiredActions:
          access.kind === 'repository'
            ? [...access.actions]
            : access.kind === 'repository-discovery'
              ? [access.action]
              : access.kind === 'service-administration'
                ? [access.action]
                : [],
      });
    }
    const candidates = items
      .sort((a, b) => (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0))
      .filter((item) => after === undefined || item.operationId > after);
    const page = candidates.slice(0, limit);
    reply.header('Cache-Control', 'private, no-store');
    return {
      apiVersion: 'v1',
      documentVersion: openApiDocument.info.version,
      gatewayRole: role,
      repository: repository ?? null,
      advisory: true,
      items: page,
      next: candidates.length > limit ? (page.at(-1)?.operationId ?? null) : null,
    };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RepositoryCleanup } from '@proanima/depot-application';
import { retentionObject } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';

export function registerCleanupRoutes(
  app: FastifyInstance,
  service: RepositoryCleanup,
  principal: (r: FastifyRequest) => Principal,
) {
  type Params = { repository: string };
  const root = '/api/v1/repositories/:repository/storage/cleanup';
  app.get<{ Params: Params }>(root, (r) => {
    retentionObject(r.query, []);
    return service.get(principal(r), r.params.repository);
  });
  app.put<{ Params: Params }>(root, (r) => {
    retentionObject(r.query, []);
    return service.save(principal(r), r.params.repository, r.body);
  });
  app.post<{ Params: Params }>(root + '/run', (r) => {
    retentionObject(r.query, []);
    return service.request(principal(r), r.params.repository, r.body);
  });
}

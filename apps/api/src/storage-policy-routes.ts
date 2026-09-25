import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorizeAction, DepotError, retentionObject } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import type { RepositoryStorage, StoragePolicyStore } from '@proanima/depot-application';

export function registerStoragePolicyRoutes(
  app: FastifyInstance,
  service: RepositoryStorage,
  store: StoragePolicyStore,
  principal: (r: FastifyRequest) => Principal,
) {
  type Params = { repository: string };
  const root = '/api/v1/repositories/:repository/storage';
  const noQuery = (r: FastifyRequest) => {
    retentionObject(r.query, []);
  };
  app.get<{ Params: Params }>(root + '/policy', (r) => {
    noQuery(r);
    return service.get(principal(r), r.params.repository);
  });
  app.put<{ Params: Params }>(root + '/policy', (r) => {
    noQuery(r);
    return service.save(principal(r), r.params.repository, r.body);
  });
  app.get<{ Params: Params }>(root + '/usage', (r) => {
    noQuery(r);
    return service.usage(principal(r), r.params.repository);
  });
  app.get<{ Params: Params }>(root + '/preview', (r) => {
    noQuery(r);
    return service.preview(principal(r), r.params.repository);
  });
  app.post<{ Params: Params }>(root + '/run', (r) => {
    noQuery(r);
    return service.run(principal(r), r.params.repository, r.body);
  });
  app.get<{ Params: Params }>(root + '/events', (r) => {
    authorizeAction(principal(r), r.params.repository, 'diagnostics.read', null);
    const q = retentionObject(r.query, ['after', 'level']),
      after = q['after'] ?? '0',
      level = q['level'];
    if (
      typeof after !== 'string' ||
      !/^(0|[1-9][0-9]{0,18})$/.test(after) ||
      BigInt(after) > 9223372036854775807n ||
      (level !== undefined && level !== 'info' && level !== 'warning' && level !== 'error')
    )
      throw new DepotError('invalid_input', 'Invalid event cursor or level');
    return store.events(r.params.repository, after, level);
  });
}

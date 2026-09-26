import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ArtifactRetention } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';

export function registerRetentionRoutes(
  app: FastifyInstance,
  retention: ArtifactRetention,
  principal: (request: FastifyRequest) => Principal,
) {
  type Params = { repository: string; id: string };
  const root = '/api/v1/repositories/:repository';
  // Explicit query rejection avoids silently ignoring a caller's proposed safety filter.
  const noQuery = (request: FastifyRequest) => {
    if (request.query && typeof request.query === 'object' && Object.keys(request.query).length)
      throw new ArkvoryError('invalid_input', 'Retention does not accept query parameters');
  };
  app.get<{ Params: Params }>(root + '/artifacts/:id/deletion', (request) => {
    noQuery(request);
    return retention.inspect(principal(request), request.params.repository, request.params.id);
  });
  app.delete<{ Params: Params; Body: unknown }>(root + '/artifacts/:id', (request) => {
    noQuery(request);
    return retention.remove(
      principal(request),
      request.params.repository,
      request.params.id,
      request.body,
    );
  });
  app.post<{ Params: Params; Body: unknown }>(root + '/retention/preview', (request) => {
    noQuery(request);
    return retention.preview(principal(request), request.params.repository, request.body);
  });
  app.post<{ Params: Params; Body: unknown }>(root + '/retention/apply', (request) => {
    noQuery(request);
    return retention.apply(principal(request), request.params.repository, request.body);
  });
}

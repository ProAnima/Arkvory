import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { listRepositories, repositoryCard } from '@proanima/arkvory-application';

function query(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Invalid repository query');
  const q: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(q).some((key) => !allowed.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown repository option');
  return q;
}
export function registerRepositoryRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
): void {
  app.get('/api/v1/repositories', (request) => {
    const q = query(request.query, ['after', 'limit']);
    const limit = q['limit'],
      after = q['after'];
    if (
      (limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit))) ||
      (after !== undefined && typeof after !== 'string')
    )
      throw new ArkvoryError('invalid_input', 'Invalid repository page');
    return Promise.resolve(
      listRepositories(principal(request), limit === undefined ? 50 : Number(limit), after),
    );
  });
  app.get<{ Params: { repository: string } }>('/api/v1/repositories/:repository', (request) => {
    query(request.query, []);
    return Promise.resolve(repositoryCard(principal(request), request.params.repository));
  });
}

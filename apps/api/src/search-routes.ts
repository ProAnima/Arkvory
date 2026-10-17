import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { GlobalSearch } from '@proanima/arkvory-application';

function query(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Object required');
  return Object.fromEntries(Object.entries(value));
}

/** `GET /api/v1/search` (ADR 0081, A1); the scenario validates every parameter itself. */
export function registerGlobalSearchRoute(
  app: FastifyInstance,
  search: GlobalSearch,
  principal: (request: FastifyRequest) => Principal,
) {
  app.get<{ Querystring: unknown }>('/api/v1/search', async (request) => {
    const q = query(request.query);
    return search.search(principal(request), {
      q: q['q'],
      repositories: q['repositories'],
      labels: q['labels'],
      stage: q['stage'],
      after: q['after'],
      limit: q['limit'],
    });
  });
}

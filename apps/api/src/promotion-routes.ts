import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ArtifactPromotion, PackageResolver } from '@proanima/arkvory-application';

interface Services {
  promotion: ArtifactPromotion;
  resolver: PackageResolver;
  principal: (request: FastifyRequest) => Principal;
  modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
}
type Params = { repository: string; id: string; stage: string };

function query(value: unknown, allowed: readonly string[]): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Invalid query');
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !allowed.includes(key) || typeof item !== 'string'))
    throw new ArkvoryError('invalid_input', 'Unknown or repeated query option');
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}
function limit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100)
    throw new ArkvoryError('invalid_input', 'Invalid page size');
  return Number(value);
}
function comment(body: unknown): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body))
    throw new ArkvoryError('invalid_input', 'Invalid stage request');
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(body));
  if (Object.keys(input).some((key) => key !== 'comment'))
    throw new ArkvoryError('invalid_input', 'Unknown stage field');
  return input['comment'];
}

export function registerPromotionRoutes(app: FastifyInstance, s: Services) {
  const base = '/api/v1/repositories/:repository';
  const who = s.principal;
  app.get<{ Params: Params }>(`${base}/artifacts/:id/stages`, async (request) => ({
    items: await s.promotion.stages(who(request), request.params.repository, request.params.id),
  }));
  app.put<{ Params: Params; Body: unknown }>(
    `${base}/artifacts/:id/stages/:stage`,
    async (request) => {
      const { repository, id, stage } = request.params;
      return s.promotion.setStage(who(request), repository, id, stage, comment(request.body));
    },
  );
  app.delete<{ Params: Params }>(`${base}/artifacts/:id/stages/:stage`, async (request, reply) => {
    const { repository, id, stage } = request.params;
    await s.promotion.removeStage(who(request), repository, id, stage);
    return reply.code(204).send();
  });
  app.get<{ Params: Params; Querystring: unknown }>(
    `${base}/artifacts/:id/promotions`,
    (request) => {
      const q = query(request.query, ['after', 'limit']);
      const { repository, id } = request.params;
      return s.promotion.history(who(request), repository, id, q['after'], limit(q['limit'], 50));
    },
  );
  app.post<{ Params: Params; Body: unknown }>(`${base}/artifacts/:id/promote`, (request, reply) =>
    s.modifying(request, async () => {
      const { repository, id } = request.params;
      const result = await s.promotion.promote(who(request), repository, id, request.body);
      return reply.code(result.created ? 201 : 200).send(result);
    }),
  );
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/stages`, (request) => {
    const q = query(request.query, ['stage', 'after', 'limit', 'ids']);
    const ids = q['ids']?.split(',');
    return s.promotion.stagedArtifacts(who(request), request.params.repository, {
      ...(q['stage'] === undefined ? {} : { stage: q['stage'] }),
      ...(q['after'] === undefined ? {} : { after: q['after'] }),
      ...(ids === undefined ? {} : { ids }),
      limit: limit(q['limit'], 100),
    });
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/promotions`, (request) => {
    const q = query(request.query, ['after', 'limit']);
    return s.promotion.repositoryEvents(
      who(request),
      request.params.repository,
      q['after'],
      limit(q['limit'], 50),
    );
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/packages/resolve`, (request) =>
    s.resolver.resolve(who(request), request.params.repository, request.query),
  );
}

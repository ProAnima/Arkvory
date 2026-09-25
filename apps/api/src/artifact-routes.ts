import type { FastifyInstance } from 'fastify';
import type { StorageService } from '@proanima/depot-application';
import { DepotError } from '@proanima/depot-domain';
import { uploadSchema } from '@proanima/depot-contracts';
import { wireUpload as wire } from './upload-response.js';
import type { RequestContext } from './request-context.js';

export function registerArtifactRoutes(
  app: FastifyInstance,
  service: Pick<StorageService, 'artifact' | 'list'>,
  principal: RequestContext['principal'],
) {
  type Params = { repository: string; id: string };
  const base = '/api/v1/repositories/:repository';
  app.get<{ Params: Params }>(
    `${base}/artifacts/:id`,
    { schema: { response: { 200: uploadSchema } } },
    async (request) =>
      wire(
        await service.artifact(principal(request), request.params.repository, request.params.id),
      ),
  );
  app.get<{ Params: Params; Querystring: { after?: string; limit?: string } }>(
    `${base}/artifacts`,
    async (request) => {
      const { after, limit } = request.query;
      if (
        (after !== undefined && typeof after !== 'string') ||
        (limit !== undefined && (typeof limit !== 'string' || !/^[0-9]{1,3}$/.test(limit)))
      )
        throw new DepotError('invalid_input', 'Invalid pagination');
      const pageSize = limit === undefined ? 50 : Number(limit);
      const items = await service.list(
        principal(request),
        request.params.repository,
        after,
        pageSize,
      );
      return {
        items: items.map(wire),
        next: items.length === pageSize ? (items.at(-1)?.id ?? null) : null,
      };
    },
  );
}

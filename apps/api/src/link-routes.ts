import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { DownloadLinks } from '@proanima/arkvory-application';

/** `{}` or `{ "ttlSeconds": n }`; anything else names the offending field. */
function lifetime(body: unknown): number | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body))
    throw new ArkvoryError('invalid_input', 'Link request must be an object', {
      details: [{ field: '', problem: 'type' }],
    });
  const unknown = Object.keys(body).find((key) => key !== 'ttlSeconds');
  if (unknown !== undefined)
    throw new ArkvoryError('invalid_input', 'Unknown link field', {
      details: [{ field: `/${unknown}`, problem: 'unknown_field' }],
    });
  const value = 'ttlSeconds' in body ? body.ttlSeconds : undefined;
  if (value !== undefined && typeof value !== 'number')
    throw new ArkvoryError('invalid_input', 'Link lifetime must be a number of seconds', {
      details: [{ field: '/ttlSeconds', problem: 'type' }],
    });
  return value;
}

/**
 * POST /api/v1/repositories/{repository}/artifacts/{id}/links (ADR 0062). The token is in this
 * response only; the content URL is relative to the API origin, as the caller reached it.
 */
export function registerLinkRoutes(
  app: FastifyInstance,
  links: Pick<DownloadLinks, 'create'>,
  principal: (request: FastifyRequest) => Principal,
) {
  type Path = { Params: { repository: string; id: string } };
  app.post<Path>('/api/v1/repositories/:repository/artifacts/:id/links', async (request, reply) => {
    retentionObject(request.query, []);
    const { repository, id } = request.params;
    const ttl = lifetime(request.body);
    const created = await links.create(principal(request), repository, id, ttl);
    const url =
      `/api/v1/repositories/${encodeURIComponent(repository)}/artifacts/` +
      `${encodeURIComponent(id)}/content?token=${created.token}`;
    return reply.code(201).send({ token: created.token, url, expiresAt: created.expiresAt });
  });
}

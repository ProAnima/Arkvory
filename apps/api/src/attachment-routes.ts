import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { BuildAttachments } from '@proanima/arkvory-application';

export function registerAttachmentRoutes(
  app: FastifyInstance,
  attachments: BuildAttachments,
  principal: (request: FastifyRequest) => Principal,
) {
  type Params = { repository: string; id: string };
  const root = '/api/v1/repositories/:repository/artifacts/:id/attachments';
  app.get<{ Params: Params }>(root, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return attachments.get(principal(request), request.params.repository, request.params.id);
  });
  app.put<{ Params: Params; Body: unknown }>(root, (request) => {
    const body = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new ArkvoryError('invalid_input', 'Object required');
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(body));
    if (
      Object.keys(input).some((key) => !['expectedRevision', 'items'].includes(key)) ||
      typeof input['expectedRevision'] !== 'number'
    )
      throw new ArkvoryError('invalid_input', 'Invalid attachment update');
    return attachments.replace(
      principal(request),
      request.params.repository,
      request.params.id,
      input['expectedRevision'],
      input['items'],
    );
  });
  app.get<{ Params: Params; Querystring: Record<string, unknown> }>(
    `${root}/history`,
    (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const before = request.query['before'];
      if (
        Object.keys(request.query).some((key) => key !== 'before') ||
        (before !== undefined && (typeof before !== 'string' || !/^[1-9][0-9]{0,9}$/.test(before)))
      )
        throw new ArkvoryError('invalid_input', 'Invalid history cursor');
      return attachments.history(
        principal(request),
        request.params.repository,
        request.params.id,
        before === undefined ? undefined : Number(before),
      );
    },
  );
}

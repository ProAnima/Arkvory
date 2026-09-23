import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DepotError, PART_BYTES } from '@proanima/depot-domain';
import { organizePackages, parsePackageListOptions } from '@proanima/depot-application';
import type { Principal } from '@proanima/depot-domain';
import type { StorageService, ArtifactCatalog, CompletionQueue } from '@proanima/depot-application';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Object required');
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new DepotError('invalid_input', 'String required');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number')
    throw new DepotError('invalid_input', 'Numeric expectedRevision required');
  return value;
}
function queryRevision(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value))
    throw new DepotError('invalid_input', 'Positive asset revision required');
  return Number(value);
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  services: {
    storage: StorageService;
    browse: ArtifactCatalog;
    queue: CompletionQueue;
    principal: (request: FastifyRequest) => Principal;
    signal: (request: FastifyRequest, reply: FastifyReply) => AbortSignal;
    modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
    uploadStream: (
      request: FastifyRequest,
      reply: FastifyReply,
      stream: Readable,
    ) => AsyncIterable<Uint8Array>;
  },
) {
  const { storage, browse, queue, principal, signal, modifying, uploadStream } = services;
  type Params = { repository: string; id: string; index: string };
  const base = '/api/v1/repositories/:repository';
  app.get<{ Params: Params }>(`${base}/uploads/:id/parts`, async (request) => ({
    partBytes: PART_BYTES,
    items: await storage.parts(principal(request), request.params.repository, request.params.id),
  }));
  app.put<{ Params: Params }>(`${base}/uploads/:id/parts/:index`, async (request, reply) => {
    if (!(request.body instanceof Readable) || !/^\d{1,3}$/.test(request.params.index))
      throw new DepotError('invalid_input', 'Invalid part request');
    const stream = request.body;
    try {
      await modifying(request, () =>
        storage.uploadPart(
          principal(request),
          request.params.repository,
          request.params.id,
          Number(request.params.index),
          string(request.headers['x-content-sha256']),
          uploadStream(request, reply, stream),
          signal(request, reply),
        ),
      );
      return await reply.code(204).send();
    } catch (error) {
      reply.header('Connection', 'close');
      throw error;
    }
  });
  app.post<{ Params: Params }>(`${base}/uploads/:id/complete-async`, async (request, reply) =>
    reply
      .code(202)
      .send(await queue.enqueue(principal(request), request.params.repository, request.params.id)),
  );
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id', async (request) =>
    queue.get(principal(request), request.params.id),
  );
  app.get<{ Params: Params }>(`${base}/artifacts/:id/annotations`, async (request) =>
    browse.annotation(principal(request), request.params.repository, request.params.id),
  );
  app.put<{ Params: Params; Body: unknown }>(
    `${base}/artifacts/:id/annotations`,
    async (request) => {
      const body = object(request.body);
      return browse.annotate(
        principal(request),
        request.params.repository,
        request.params.id,
        revision(body['expectedRevision']),
        body['value'],
      );
    },
  );
  app.post<{ Params: Params }>(`${base}/artifacts/:id/package`, async (request) =>
    modifying(request, () =>
      browse.register(principal(request), request.params.repository, request.params.id),
    ),
  );
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/packages`, async (request) => {
    const q = object(request.query);
    const options = parsePackageListOptions(q);
    return organizePackages(
      await browse.packages(
        principal(request),
        request.params.repository,
        q['group'] === undefined ? undefined : string(q['group']),
        q['name'] === undefined ? undefined : string(q['name']),
      ),
      options,
    );
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/assets`, async (request) => ({
    items: await browse.assets(
      principal(request),
      request.params.repository,
      string(object(request.query)['prefix'], ''),
    ),
  }));
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/asset`, async (request) =>
    browse.asset(
      principal(request),
      request.params.repository,
      string(object(request.query)['path']),
    ),
  );
  app.put<{ Params: Params; Body: unknown }>(`${base}/asset`, async (request) => {
    const body = object(request.body);
    return browse.setAsset(
      principal(request),
      request.params.repository,
      string(body['path']),
      string(body['artifactId']),
      revision(body['expectedRevision']),
    );
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/asset/history`, async (request) => {
    const q = object(request.query);
    return browse.assetHistory(
      principal(request),
      request.params.repository,
      string(q['path']),
      q['before'] === undefined ? undefined : queryRevision(q['before']),
    );
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/asset/revision`, async (request) => {
    const q = object(request.query);
    return browse.assetRevision(
      principal(request),
      request.params.repository,
      string(q['path']),
      queryRevision(q['revision']),
    );
  });
  app.post<{ Params: Params; Body: unknown }>(`${base}/asset/restore`, async (request) => {
    const body = object(request.body);
    if (
      Object.keys(body).some((key) => !['path', 'sourceRevision', 'expectedRevision'].includes(key))
    )
      throw new DepotError('invalid_input', 'Unknown restore field');
    return browse.restoreAsset(
      principal(request),
      request.params.repository,
      string(body['path']),
      revision(body['sourceRevision']),
      revision(body['expectedRevision']),
    );
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/search`, async (request) => {
    const q = object(request.query);
    const items = await browse.search(
      principal(request),
      request.params.repository,
      string(q['q'], ''),
      string(q['label'], ''),
      string(q['collection'], ''),
      q['after'] === undefined ? undefined : string(q['after']),
    );
    return { items, next: items.length === 100 ? (items.at(-1)?.id ?? null) : null };
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/audit`, async (request) => ({
    items: await browse.audit(
      principal(request),
      request.params.repository,
      string(object(request.query)['after'], '0'),
    ),
  }));
  app.route<{ Params: Params; Body: unknown }>({
    method: ['POST', 'DELETE'],
    url: `${base}/artifacts/:id/references`,
    handler: async (request, reply) => {
      await browse.reference(
        principal(request),
        request.params.repository,
        request.params.id,
        string(object(request.body)['key']),
        request.method === 'DELETE',
      );
      return reply.code(204).send();
    },
  });
}

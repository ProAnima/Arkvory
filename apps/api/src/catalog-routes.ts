import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { organizePackages, parsePackageListOptions } from '@proanima/arkvory-application';
import type { Principal } from '@proanima/arkvory-domain';
import type { ArtifactCatalog } from '@proanima/arkvory-application';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Object required');
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new ArkvoryError('invalid_input', 'String required');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number')
    throw new ArkvoryError('invalid_input', 'Numeric expectedRevision required');
  return value;
}
function queryRevision(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Positive asset revision required');
  return Number(value);
}

// arkvory-exception ARCH-014 -- Existing route registrar groups endpoints with shared authorizer dependencies; separate by responsibility with the complete operation inventory unchanged.
export function registerCatalogRoutes(
  app: FastifyInstance,
  services: {
    browse: ArtifactCatalog;
    principal: (request: FastifyRequest) => Principal;
    modifying: <T>(request: FastifyRequest, action: () => Promise<T>) => Promise<T>;
  },
) {
  const { browse, principal, modifying } = services;
  type Params = { repository: string; id: string; index: string };
  const base = '/api/v1/repositories/:repository';
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
    const rawLimit = q['limit'];
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(rawLimit))
    )
      throw new ArkvoryError('invalid_input', 'Invalid package page size');
    const page = await browse.packagePage(
      principal(request),
      request.params.repository,
      q['group'] === undefined ? undefined : string(q['group']),
      q['name'] === undefined ? undefined : string(q['name']),
      options,
      q['after'] === undefined ? undefined : string(q['after']),
      rawLimit === undefined ? 50 : Number(rawLimit),
    );
    return { ...organizePackages(page.items, options), next: page.next };
  });
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/assets`, async (request) => ({
    items: await browse.assets(
      principal(request),
      request.params.repository,
      string(object(request.query)['prefix'], ''),
    ),
  }));
  app.get<{ Params: Params; Querystring: unknown }>(`${base}/assets/page`, (request) => {
    const q = object(request.query);
    if (Object.keys(q).some((key) => !['prefix', 'after', 'limit'].includes(key)))
      throw new ArkvoryError('invalid_input', 'Unknown asset page option');
    const limit = q['limit'];
    if (limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit)))
      throw new ArkvoryError('invalid_input', 'Invalid asset page size');
    return browse.assetPage(principal(request), request.params.repository, {
      prefix: string(q['prefix'], ''),
      limit: limit === undefined ? 50 : Number(limit),
      ...(q['after'] === undefined ? {} : { after: string(q['after']) }),
    });
  });
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
      throw new ArkvoryError('invalid_input', 'Unknown restore field');
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

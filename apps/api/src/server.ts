import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { DepotError } from '@proanima/depot-domain';
import type { Principal, Upload } from '@proanima/depot-domain';
import { StorageService, ArtifactCatalog, CompletionQueue } from '@proanima/depot-application';
import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresBrowse,
  ZipManifestReader,
  PostgresJobs,
  AdmissionQueue,
} from '@proanima/depot-infrastructure';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerConsole } from './console.js';
import { ProGetDownloads } from '@proanima/depot-proget-compat';
import { descriptorSchema, openApiDocument, uploadSchema } from '@proanima/depot-contracts';
import type { UploadResponse } from '@proanima/depot-contracts';
import type { ServerConfig } from './config.js';
import { matchesEtag, parseRange } from './range.js';

function wire(upload: Upload): UploadResponse {
  return {
    id: upload.id,
    repository: upload.repository,
    status: upload.status,
    createdAt: upload.createdAt,
    expiresAt: upload.expiresAt,
    descriptor: { ...upload.descriptor, size: String(upload.descriptor.size) },
  };
}

export async function createServer(config: ServerConfig) {
  const catalog = new PostgresCatalog(config.databaseUrl, config.capacityBytes, config.maxUploads);
  const blobs = new LocalBlobStore(config.dataDirectory);
  try {
    await blobs.initialize();
    await catalog.ready();
    await catalog.claimStorage(await blobs.identity());
  } catch (error) {
    await catalog.close();
    throw error;
  }
  const service = new StorageService(catalog, blobs, {
    next: randomUUID,
    now: () => new Date().toISOString(),
  });
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    requestTimeout: 30 * 60 * 1000,
    connectionTimeout: 30000,
    return503OnClosing: true,
    forceCloseConnections: true,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const principals = new WeakMap<FastifyRequest, Principal>();
  const uploadGate = new AdmissionQueue(config.maxUploads);
  const downloadGate = new AdmissionQueue(config.maxDownloads);
  let requests = 0;
  const principal = (request: FastifyRequest): Principal => {
    const result = principals.get(request);
    if (!result) throw new DepotError('forbidden', 'Authentication required');
    return result;
  };
  const signal = (request: FastifyRequest, reply: FastifyReply): AbortSignal => {
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    request.raw.once('aborted', abort);
    reply.raw.once('close', () => {
      request.raw.removeListener('aborted', abort);
      if (!reply.raw.writableFinished) abort();
    });
    if (request.raw.destroyed) abort();
    return controller.signal;
  };
  app.addHook('onClose', async () => {
    uploadGate.close();
    downloadGate.close();
    await catalog.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Request-Id', request.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    if (
      request.routeOptions.url === '/health/live' ||
      request.routeOptions.url?.startsWith('/console/')
    )
      return;
    if (!catalog.active)
      throw new DepotError(
        'unavailable',
        'Standalone database ownership lost; restart the service',
      );
    const auth = request.headers.authorization;
    const legacy = request.url.startsWith('/upack/') || request.url.startsWith('/endpoints/');
    let token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (legacy && typeof request.headers['x-apikey'] === 'string')
      token = request.headers['x-apikey'];
    if (legacy && auth?.startsWith('Basic ')) {
      const basic = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      if (basic.startsWith('api:')) token = basic.slice(4);
    }
    const digest = createHash('sha256').update(token).digest();
    const key = config.keys.find((candidate) =>
      timingSafeEqual(digest, Buffer.from(candidate.sha256, 'hex')),
    );
    if (token.length < 32 || token.length > 512 || !key) {
      await reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        code: 'unauthorized',
        message: 'Valid service key required',
        requestId: request.id,
      });
      return;
    }
    principals.set(request, key.principal);
    if (requests >= 128) throw new DepotError('busy', 'Request capacity exceeded');
    requests++;
    let released = false;
    reply.raw.once('close', () => {
      if (!released) {
        requests--;
        released = true;
      }
    });
  });
  app.setErrorHandler((error, request, reply) => {
    const codes = {
      invalid_input: 400,
      not_found: 404,
      conflict: 409,
      forbidden: 403,
      capacity_exceeded: 507,
      integrity_mismatch: 422,
      busy: 503,
      unavailable: 503,
    } as const;
    if (error instanceof DepotError) {
      if (error.code === 'busy' || error.code === 'unavailable') reply.header('Retry-After', '2');
      void reply
        .code(codes[error.code])
        .send({ code: error.code, message: error.message, requestId: request.id });
    } else {
      const clientError =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode >= 400 &&
        error.statusCode < 500;
      void reply
        .code(clientError ? 400 : 503)
        .header('Retry-After', '2')
        .send({
          code: clientError ? 'invalid_input' : 'unavailable',
          message: clientError
            ? 'Invalid request'
            : 'Operation unavailable; query upload status before retrying',
          requestId: request.id,
        });
    }
  });
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });
  app.get('/health/live', () => Promise.resolve({ status: 'ok' }));
  app.get('/health/ready', async () => {
    await catalog.ready();
    await blobs.ready();
    let writable = true;
    try {
      await blobs.checkSpace(0);
    } catch (error) {
      if (error instanceof DepotError && error.code === 'capacity_exceeded') writable = false;
      else throw error;
    }
    return { status: 'ready', writable };
  });
  app.get('/api/v1/openapi.json', () => Promise.resolve(openApiDocument));
  type Params = { repository: string; id: string };
  const base = '/api/v1/repositories/:repository';
  const response = { 200: uploadSchema };
  const modifying = async <T>(request: FastifyRequest, action: () => Promise<T>): Promise<T> => {
    const abort = new AbortController();
    const cancel = () => {
      abort.abort();
    };
    request.raw.once('aborted', cancel);
    let release: (() => void) | undefined;
    try {
      release = await uploadGate.acquire(principal(request).id, abort.signal);
      if (!catalog.active) throw new DepotError('unavailable', 'Gateway ownership lost');
      return await action();
    } finally {
      release?.();
      request.raw.removeListener('aborted', cancel);
    }
  };
  app.post<{ Params: Params; Body: unknown }>(
    `${base}/uploads`,
    { schema: { body: descriptorSchema, response: { 201: uploadSchema } } },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string')
        throw new DepotError('invalid_input', 'Idempotency-Key is required');
      const result = await service.create(
        principal(request),
        request.params.repository,
        key,
        request.body,
      );
      return reply
        .code(201)
        .header(
          'Location',
          `${base.replace(':repository', request.params.repository)}/uploads/${result.id}`,
        )
        .send(wire(result));
    },
  );
  app.get<{ Params: Params }>(`${base}/uploads/:id`, { schema: { response } }, async (request) =>
    wire(await service.status(principal(request), request.params.repository, request.params.id)),
  );
  app.delete<{ Params: Params }>(`${base}/uploads/:id`, { schema: { response } }, async (request) =>
    modifying(request, async () =>
      wire(await service.cancel(principal(request), request.params.repository, request.params.id)),
    ),
  );
  app.put<{ Params: Params }>(
    `${base}/uploads/:id/content`,
    { schema: { response } },
    async (request, reply) => {
      if (!(request.body instanceof Readable))
        throw new DepotError('invalid_input', 'Content-Type must be application/octet-stream');
      const stream = request.body;
      const cancellation = signal(request, reply);
      async function* chunks(): AsyncIterable<Uint8Array> {
        for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
          if (!(chunk instanceof Uint8Array))
            throw new DepotError('invalid_input', 'Invalid request bytes');
          yield chunk;
        }
      }
      try {
        return wire(
          await modifying(request, () =>
            service.upload(
              principal(request),
              request.params.repository,
              request.params.id,
              chunks(),
              cancellation,
            ),
          ),
        );
      } catch (error) {
        reply.header('Connection', 'close');
        throw error;
      }
    },
  );
  app.post<{ Params: Params }>(
    `${base}/uploads/:id/complete`,
    { schema: { response } },
    async (request, reply) =>
      modifying(request, async () => {
        // Assembly may run without socket traffic for minutes. Admission remains bounded.
        reply.raw.setTimeout(30 * 60 * 1000, () => {
          reply.raw.destroy();
        });
        return wire(
          await service.complete(
            principal(request),
            request.params.repository,
            request.params.id,
            signal(request, reply),
          ),
        );
      }),
  );
  app.get<{ Params: Params }>(`${base}/artifacts/:id`, { schema: { response } }, async (request) =>
    wire(await service.artifact(principal(request), request.params.repository, request.params.id)),
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
  const sendContent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    repository: string,
    id: string,
  ) => {
    const releaseSlot = await downloadGate.acquire(principal(request).id, signal(request, reply));
    let released = false;
    const release = (): void => {
      if (!released) {
        releaseSlot();
        released = true;
      }
    };
    reply.raw.once('close', release);
    try {
      const result = await service.download(principal(request), repository, id);
      const { size, sha256, name } = result.upload.descriptor;
      const etag = `"sha256:${sha256}"`;
      reply
        .header('ETag', etag)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Type', 'application/octet-stream')
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(Buffer.from(name).toString('utf8')).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
        );
      if (matchesEtag(request.headers['if-none-match'], etag)) return await reply.code(304).send();
      const range =
        request.method === 'HEAD' ||
        (request.headers['if-range'] !== undefined && request.headers['if-range'] !== etag)
          ? ({ kind: 'full' } as const)
          : parseRange(request.headers.range, size);
      if (range.kind === 'unsatisfiable')
        return await reply
          .code(416)
          .header('Content-Range', `bytes */${String(size)}`)
          .header('Content-Length', '0')
          .send();
      if (range.kind === 'partial')
        reply
          .code(206)
          .header(
            'Content-Range',
            `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
          )
          .header('Content-Length', String(range.end - range.start + 1));
      else reply.header('Content-Length', String(size));
      if (request.method === 'HEAD') return await reply.send();
      return await reply.send(
        Readable.from(result.read(range.kind === 'partial' ? range : undefined), {
          objectMode: false,
          highWaterMark: 64 * 1024,
        }),
      );
    } catch (error) {
      release();
      throw error;
    }
  };
  app.route<{ Params: Params }>({
    method: ['GET', 'HEAD'],
    url: base + '/artifacts/:id/content',
    handler: (request, reply) =>
      sendContent(request, reply, request.params.repository, request.params.id),
  });
  const browse = new ArtifactCatalog(
    service,
    new PostgresBrowse(catalog.pool),
    new ZipManifestReader(blobs),
  );
  const legacy = new ProGetDownloads(browse);
  app.route<{ Params: { repository: string; '*': string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: '/upack/:repository/download/*',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.universal(
          principal(request),
          request.params.repository,
          request.params['*'],
          request.query,
        ),
      ),
  });
  app.route<{ Params: { repository: string; '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/endpoints/:repository/content/*',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.asset(principal(request), request.params.repository, request.params['*']),
      ),
  });
  registerCatalogRoutes(app, {
    storage: service,
    browse,
    queue: new CompletionQueue(new PostgresJobs(catalog.pool), randomUUID),
    principal,
    signal,
    modifying,
  });
  registerConsole(app, process.env['DEPOT_WEB_DIR'] ?? 'apps/web/public');
  return app;
}

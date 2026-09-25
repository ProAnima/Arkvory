// depot-exception ARCH-016 -- Existing composition root combines authentication, transfer routes and process lifecycle; freeze until those responsibilities are extracted under HTTP regression tests.
import { registerStoragePolicyRoutes } from './storage-policy-routes.js';
import { maintainStorage } from './storage-maintenance.js';
import { RepositoryStorage } from '@proanima/depot-application';
import { PostgresStoragePolicy, DiagnosticLogger } from '@proanima/depot-infrastructure';
import { registerRetentionRoutes } from './retention-routes.js';
import { ArtifactRetention } from '@proanima/depot-application';
import { PostgresRetention } from '@proanima/depot-infrastructure';
import { registerAttachmentRoutes } from './attachment-routes.js';
import { BuildAttachments } from '@proanima/depot-application';
import { PostgresAttachments } from '@proanima/depot-infrastructure';
import { registerRepositoryRoutes } from './repository-routes.js';
import { registerOperationRoutes } from './operation-routes.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { downloadStream } from './download-stream.js';
import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { DepotError } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';
import {
  StorageService,
  ArtifactCatalog,
  CompletionQueue,
  IdentityService,
  ServiceAccess,
} from '@proanima/depot-application';
import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresBrowse,
  ZipManifestReader,
  PostgresJobs,
  AdmissionQueue,
  BandwidthGovernor,
  PostgresDownloadLease,
  downloadShare,
  PostgresIdentity,
  PostgresServices,
} from '@proanima/depot-infrastructure';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerConsole } from './console.js';
import { registerIdentityRoutes } from './identity-routes.js';
import { registerServiceRoutes } from './service-routes.js';
import { registerContractGuard } from './contract-guard.js';
import { ProGetDownloads } from '@proanima/depot-proget-compat';
import { readinessSchema, uploadSchema } from '@proanima/depot-contracts';
import { wireUpload as wire } from './upload-response.js';
import { registerUploadRoutes } from './upload-routes.js';
import { resolveUploadTimeouts } from './upload-policy.js';
import type { ServerConfig } from './config.js';
import { matchesEtag, parseRange } from './range.js';
import { registerCors } from './cors.js';

// depot-exception ARCH-017 -- Existing composition root combines authentication, transfer routes and process lifecycle; freeze until those responsibilities are extracted under HTTP regression tests.
export async function createServer(config: ServerConfig) {
  const uploadPolicy = resolveUploadTimeouts(config);
  const role: unknown = config.role ?? 'api';
  if (role !== 'api' && role !== 'reader') throw new Error('Invalid gateway role');
  if (
    (role === 'reader' && !config.sharedDownloads) ||
    (config.sharedDownloads && (role === 'api') !== (config.sharedDownloads.slot === 0))
  )
    throw new Error('Shared downloads require writer slot zero and distinct reader slots');
  const share = config.sharedDownloads ? downloadShare(config.sharedDownloads) : undefined;
  const ceiling = (local: number | undefined, allocated: number | undefined) =>
    Math.min(local || Infinity, allocated || Infinity) === Infinity
      ? 0
      : Math.min(local || Infinity, allocated || Infinity);
  const uploadGate = new AdmissionQueue(
    config.maxUploads,
    config.transferQueueLimit ?? 64,
    config.transferQueuePerPrincipal ?? Math.min(8, config.transferQueueLimit ?? 64),
    config.transferQueueTimeoutMs ?? 20000,
    config.maxUploadsPerPrincipal ?? 1,
  );
  const downloadGate = new AdmissionQueue(
    config.maxDownloads,
    config.transferQueueLimit ?? 64,
    config.transferQueuePerPrincipal ?? Math.min(8, config.transferQueueLimit ?? 64),
    config.transferQueueTimeoutMs ?? 20000,
    config.maxDownloadsPerPrincipal ?? Math.min(4, config.maxDownloads),
  );
  const loginGate = new AdmissionQueue(2, 16, 16, 1000, 2);
  const catalog = new PostgresCatalog(config.databaseUrl, config.capacityBytes, config.maxUploads);
  const identity = new IdentityService(new PostgresIdentity(catalog.pool));
  const serviceAccounts = new PostgresServices(catalog.pool);
  const blobs = new LocalBlobStore(config.dataDirectory);
  const lease = config.sharedDownloads
    ? new PostgresDownloadLease(catalog.pool, config.sharedDownloads)
    : undefined;
  const available = () => catalog.active && (lease?.active ?? true);
  const owners = [...new Set(config.keys.map((key) => key.principal.id))];
  const uploadBandwidth = new BandwidthGovernor(
    {
      bytesPerSecond: config.uploadBytesPerSecond ?? 0,
      perPrincipalBytesPerSecond: config.uploadBytesPerSecondPerPrincipal ?? 0,
    },
    owners,
    available,
  );
  const downloadBandwidth = new BandwidthGovernor(
    {
      bytesPerSecond: ceiling(config.downloadBytesPerSecond, share?.bytesPerSecond),
      perPrincipalBytesPerSecond: ceiling(
        config.downloadBytesPerSecondPerPrincipal,
        share?.perPrincipalBytesPerSecond,
      ),
    },
    owners,
    available,
  );
  try {
    if (role === 'reader') await blobs.ready();
    else await blobs.initialize();
    await catalog.ready();
    await catalog.claimStorage(
      await blobs.identity(role === 'reader'),
      role,
      !!config.sharedDownloads,
    );
    await lease?.start();
  } catch (error) {
    lease?.close();
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
  const storagePolicies = new PostgresStoragePolicy(catalog.pool);
  const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString());
  const diagnosticQueue: {
    repository: string;
    level: 'warning' | 'error';
    code: string;
    details: Record<string, string | number>;
  }[] = [];
  let diagnosticDropped = 0;
  let maintenance: Promise<void> | undefined;
  let flushing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  const flush = async () => {
    for (let i = 0; i < 10; i++) {
      const event = diagnosticQueue.shift();
      if (!event) break;
      try {
        await storagePolicies.recordEvent(event.repository, event.level, event.code, event.details);
      } catch {
        diagnostics.write({
          level: 'error',
          component: 'storage',
          code: 'diagnostics.persist_failed',
        });
        break;
      }
    }
    if (diagnosticDropped) {
      diagnostics.write({
        level: 'warning',
        component: 'storage',
        code: `diagnostics.queue_dropped.${String(diagnosticDropped)}`,
      });
      diagnosticDropped = 0;
    }
  };
  app.addHook('onReady', () => {
    if (role === 'api')
      timer = setInterval(() => {
        if (maintenance || !available()) return;
        maintenance = maintainStorage(storagePolicies, serviceAccounts, available)
          .catch(() => {
            diagnostics.write({
              level: 'error',
              component: 'storage',
              code: 'maintenance.unavailable',
            });
          })
          .finally(() => {
            maintenance = undefined;
          });
      }, 60000);
    flushTimer = setInterval(() => {
      if (!flushing)
        flushing = flush().finally(() => {
          flushing = undefined;
        });
    }, 1000);
    timer?.unref();
    flushTimer.unref();
    return Promise.resolve();
  });
  app.addHook('preClose', async () => {
    clearInterval(timer);
    clearInterval(flushTimer);
    await maintenance;
    await flushing;
    // Bound shutdown flushing; stdout already records every accepted diagnostic.
    await flush();
    diagnosticQueue.length = 0;
    diagnostics.close();
  });
  registerContractGuard(app);
  registerCors(app, config.corsOrigins ?? []);
  const principals = new WeakMap<FastifyRequest, Principal>();
  const requestSignals = new WeakMap<FastifyRequest, AbortSignal>();
  const errorCodes = new WeakMap<FastifyRequest, string>();
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode < 400) return;
    const level = reply.statusCode >= 500 ? 'error' : 'warning';
    const code = errorCodes.get(request) ?? `http.${String(reply.statusCode)}`;
    const route = request.routeOptions.url ?? 'unmatched';
    const params: unknown = request.params;
    const repository =
      params &&
      typeof params === 'object' &&
      'repository' in params &&
      typeof params.repository === 'string' &&
      /^[a-z0-9][a-z0-9_-]{0,63}$/.test(params.repository)
        ? params.repository
        : undefined;
    diagnostics.write({
      level,
      component: 'api',
      code,
      requestId: request.id,
      route,
      method: request.method,
      status: reply.statusCode,
    });
    // Unknown/unauthenticated repository names cannot poison another repository's event stream.
    const p = principals.get(request);
    if (
      repository &&
      p?.managed?.bindings.some((b) => b.resource.id === repository && b.actions.length > 0)
    ) {
      if (diagnosticQueue.length < 128)
        diagnosticQueue.push({
          repository,
          level,
          code,
          details: {
            requestId: request.id,
            route,
            method: request.method,
            status: reply.statusCode,
          },
        });
      else diagnosticDropped++;
    }
  });
  let requests = 0;
  const principal = (request: FastifyRequest): Principal => {
    const result = principals.get(request);
    if (!result) throw new DepotError('forbidden', 'Authentication required');
    return result;
  };
  const signal = (request: FastifyRequest, reply: FastifyReply): AbortSignal => {
    const existing = requestSignals.get(request);
    if (existing) return existing;
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
    requestSignals.set(request, controller.signal);
    return controller.signal;
  };
  const countRequest = (reply: FastifyReply) => {
    if (requests >= 128) throw new DepotError('busy', 'Request capacity exceeded');
    requests++;
    let released = false;
    reply.raw.once('close', () => {
      if (!released) {
        requests--;
        released = true;
      }
    });
  };
  app.addHook('preClose', () => {
    uploadGate.close();
    downloadGate.close();
    loginGate.close();
    uploadBandwidth.close();
    downloadBandwidth.close();
    lease?.close();
    return Promise.resolve();
  });
  app.addHook('onClose', async () => {
    uploadGate.close();
    downloadGate.close();
    loginGate.close();
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
    if (!available())
      throw new DepotError(
        'unavailable',
        'Gateway ownership or download lease lost; restart the service',
      );
    // Admission precedes asynchronous authentication: session lookup also consumes resources.
    signal(request, reply);
    countRequest(reply);
    if (request.routeOptions.url === '/api/v1/auth/login') {
      if (role === 'reader')
        await reply.code(405).header('Allow', 'GET, HEAD').send({
          code: 'read_only',
          message: 'Read gateway does not accept mutations',
          requestId: request.id,
        });
      return;
    }
    const auth = request.headers.authorization;
    const legacy =
      request.url.startsWith('/upack/') ||
      request.url.startsWith('/endpoints/') ||
      request.url.startsWith('/api/packages/');
    let token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (legacy && typeof request.headers['x-apikey'] === 'string')
      token = request.headers['x-apikey'];
    if (legacy && auth?.startsWith('Basic ')) {
      const basic = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      if (basic.startsWith('api:')) token = basic.slice(4);
    }
    const digest = createHash('sha256').update(token).digest();
    const key = token.startsWith('dpk_')
      ? undefined
      : config.keys.find((candidate) =>
          timingSafeEqual(digest, Buffer.from(candidate.sha256, 'hex')),
        );
    const authenticated =
      token.length >= 32 && token.length <= 512
        ? token.startsWith('dpk_')
          ? await serviceAccounts.resolve(
              token,
              request.routeOptions.url === '/api/v1/auth/activate-key',
            )
          : (key?.principal ?? (await identity.resolve(token)))
        : null;
    if (!authenticated) {
      await reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        code: 'unauthorized',
        message: 'Valid service key required',
        requestId: request.id,
      });
      return;
    }
    principals.set(request, authenticated);
    if (authenticated.id.startsWith('user:') || authenticated.managed) {
      uploadBandwidth.register(authenticated.id);
      downloadBandwidth.register(authenticated.id);
    }
    if (role === 'reader' && request.method !== 'GET' && request.method !== 'HEAD') {
      await reply.code(405).header('Allow', 'GET, HEAD').send({
        code: 'read_only',
        message: 'Read gateway does not accept mutations',
        requestId: request.id,
      });
      return;
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const codes = {
      invalid_input: 400,
      not_found: 404,
      conflict: 409,
      forbidden: 403,
      unauthorized: 401,
      capacity_exceeded: 507,
      integrity_mismatch: 422,
      busy: 503,
      unavailable: 503,
    } as const;
    if (error instanceof DepotError) {
      errorCodes.set(request, error.code);
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
      errorCodes.set(request, clientError ? 'invalid_input' : 'unavailable');
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
  app.get('/health/ready', { schema: { response: { 200: readinessSchema } } }, async () => {
    await catalog.ready();
    await blobs.ready();
    let writable = role === 'api';
    try {
      if (writable) await blobs.checkSpace(0);
    } catch (error) {
      if (error instanceof DepotError && error.code === 'capacity_exceeded') writable = false;
      else throw error;
    }
    if (!available())
      throw new DepotError('unavailable', 'Gateway ownership or download lease lost');
    return {
      status: 'ready',
      writable,
      role,
      sharedDownloads: lease?.snapshot ?? null,
      transfers: {
        uploads: { admission: uploadGate.snapshot, bandwidth: uploadBandwidth.snapshot },
        downloads: { admission: downloadGate.snapshot, bandwidth: downloadBandwidth.snapshot },
      },
    };
  });
  registerOperationRoutes(app, new ServiceAccess(serviceAccounts), principal, role);
  registerIdentityRoutes(app, identity, principal, loginGate, signal);
  registerServiceRoutes(app, new ServiceAccess(serviceAccounts), principal, role);
  registerRepositoryRoutes(app, principal);
  type Params = { repository: string; id: string };
  const base = '/api/v1/repositories/:repository';
  const modifying = async <T>(request: FastifyRequest, action: () => Promise<T>): Promise<T> => {
    const abort = new AbortController();
    const cancel = () => {
      abort.abort();
    };
    request.raw.once('aborted', cancel);
    let release: (() => void) | undefined;
    try {
      const requestSignal = requestSignals.get(request);
      release = await uploadGate.acquire(
        principal(request).id,
        requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal,
      );
      if (!available()) throw new DepotError('unavailable', 'Gateway ownership lost');
      return await action();
    } finally {
      release?.();
      request.raw.removeListener('aborted', cancel);
    }
  };
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
        downloadStream(
          downloadBandwidth.stream(
            result.read(range.kind === 'partial' ? range : undefined),
            principal(request).id,
            signal(request, reply),
          ),
          request,
          signal(request, reply),
          diagnostics,
        ),
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
  app.route<{ Params: { repository: string }; Querystring: unknown }>({
    method: ['GET', 'HEAD'],
    url: '/api/packages/:repository/download',
    handler: async (request, reply) =>
      sendContent(
        request,
        reply,
        request.params.repository,
        await legacy.common(principal(request), request.params.repository, request.query),
      ),
  });
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
  registerStoragePolicyRoutes(
    app,
    new RepositoryStorage(storagePolicies),
    storagePolicies,
    principal,
  );
  registerRetentionRoutes(
    app,
    new ArtifactRetention(new PostgresRetention(catalog.pool), () => new Date().toISOString()),
    principal,
  );
  registerAttachmentRoutes(
    app,
    new BuildAttachments(service, new PostgresAttachments(catalog.pool)),
    principal,
  );
  registerUploadRoutes(app, {
    storage: service,
    queue: new CompletionQueue(new PostgresJobs(catalog.pool), randomUUID),
    principal,
    signal,
    modifying,
    bandwidth: uploadBandwidth,
    policy: uploadPolicy,
    diagnostics,
  });
  registerCatalogRoutes(app, { browse, principal, modifying });
  if (role === 'api') registerConsole(app, process.env['DEPOT_WEB_DIR'] ?? 'apps/web/public');
  return app;
}

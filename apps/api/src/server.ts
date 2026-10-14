import type { FastifyInstance } from 'fastify';
import {
  DiagnosticLogger,
  PostgresFleetTrust,
  processIdentity,
} from '@proanima/arkvory-infrastructure';
import type { PostgresCatalog, ProcessIdentity } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import { ApiRuntime } from './api-runtime.js';
import { createApiServices } from './api-services.js';
import { registerApiRoutes } from './api-routes.js';
import { createHttpServer } from './http-server.js';
import { prepareTls } from './tls-transport.js';
import { createRequestContext } from './request-context.js';
import { registerRequestSecurity } from './request-security.js';
import { registerHttpErrors } from './http-errors.js';
import { ResponseDiagnostics } from './response-diagnostics.js';
import { registerBackgroundTasks } from './background-tasks.js';
import { registerHealthRoutes } from './health-routes.js';
import { registerContractGuard } from './contract-guard.js';
import { registerNotFound } from './not-found.js';
import { registerCors } from './cors.js';
import { registerConsole } from './console.js';
import { maintainStorage } from './storage-maintenance.js';
import { resolveUploadTimeouts } from './upload-policy.js';
import { registerUpdateRoutes } from './update-routes.js';
import { UpdateControl } from './update-control.js';
import { registerFeedback } from './feedback-routes.js';
import { registerTopologyRoutes } from './topology-routes.js';
import { registerFleetRoutes } from './fleet-routes.js';
import { RecentLog } from './recent-log.js';
import { registerOwnershipRecovery } from './ownership-recovery.js';
import { registerAccessLog } from './access-log.js';
import { RequestDrain } from './drain.js';
import { ApiMetrics, registerMetrics } from './api-metrics.js';
import type { MetricSources } from './api-metrics.js';
import { registerReplicaGuard, replicaGuardFor } from './replica-guard.js';
import type { ReplicaGuard } from './replica-guard.js';

export interface ServerLifecycle {
  onOwnershipLost?: () => void;
  drain?: RequestDrain;
  /** Process logger owned by the caller, which closes it after the server; else one is created. */
  diagnostics?: DiagnosticLogger;
  /** The newest lines of the caller's logger, for feedback reports (ADR 0060). */
  recentLog?: { text(): string };
  identity?: ProcessIdentity;
}

/** Timers for cleanup, maintenance and diagnostic persistence; stopped in preClose. */
function registerMaintenance(
  app: ReturnType<typeof createHttpServer>,
  runtime: ApiRuntime,
  services: ReturnType<typeof createApiServices>,
  responses: ResponseDiagnostics,
  diagnostics: DiagnosticLogger,
) {
  return registerBackgroundTasks(app, {
    role: runtime.role,
    available: runtime.available,
    maintain: async () => {
      try {
        await maintainStorage(
          services.storagePolicies,
          services.serviceAccounts,
          runtime.available,
          services.mirrors.readOnlyRepositories,
        );
      } finally {
        // Bounded batch; the security journal must not grow without limit under login floods.
        if (runtime.available()) await services.securityAudit.prune();
        // Abandoned image uploads and their staged bytes (ADR 0063), raw leftovers (ADR 0064).
        if (runtime.available()) await services.registry.expireUploads();
        if (runtime.available()) await services.rawStaging.prune(24 * 60 * 60);
      }
    },
    collect: () => services.collector.tick(runtime.available),
    flush: () => responses.flush(),
    close: () => {
      responses.close();
    },
    diagnostics,
  });
}

/** Process clocks and sizes of the metrics; the server passes only its own sources. */
function processMetrics(
  sources: Pick<MetricSources, 'identity' | 'transfers' | 'diagnostics' | 'jobs' | 'backup'>,
  activeRequests: () => number,
  {
    certificate,
    replica,
    catalog,
  }: {
    readonly certificate: { readonly notAfterMs: number } | undefined;
    readonly replica: ReplicaGuard | undefined;
    readonly catalog: Pick<PostgresCatalog, 'poolStats'>;
  },
): ApiMetrics {
  return new ApiMetrics({
    ...sources,
    databasePools: () => catalog.poolStats(),
    ...(replica ? { replica } : {}),
    activeRequests,
    now: () => performance.now(),
    startedAtSeconds: Math.round(Date.now() / 1000 - process.uptime()),
    residentMemory: () => process.memoryUsage.rss(),
    ...(certificate ? { tlsNotAfterMs: () => certificate.notAfterMs } : {}),
  });
}

/** The caller's logger and its recent lines, or this server's own logger with a recent log. */
function processLog(config: ServerConfig, lifecycle: ServerLifecycle, identity: ProcessIdentity) {
  if (lifecycle.diagnostics)
    return { diagnostics: lifecycle.diagnostics, recentLog: lifecycle.recentLog ?? null };
  const recentLog = new RecentLog(process.stdout);
  const diagnostics = new DiagnosticLogger(recentLog, () => new Date().toISOString(), {
    level: config.logLevel ?? 'info',
    process: identity,
  });
  return { diagnostics, recentLog };
}

/**
 * The access log and the metrics. Registered before the security hooks, so both observe every
 * response, rejections included.
 */
function registerObservation(
  app: FastifyInstance,
  parts: Omit<RouteParts, 'recentLog' | 'policy'> & {
    readonly certificate: ReturnType<Awaited<ReturnType<typeof prepareTls>>['attach']>;
  },
) {
  const { config, runtime, services, context, drain, identity, diagnostics } = parts;
  // loadConfig enables it by default; embedded/test servers opt in explicitly.
  if (config.accessLog === true)
    registerAccessLog(app, {
      writer: diagnostics,
      principal: context.peekPrincipal,
      now: () => performance.now(),
    });
  registerMetrics(
    app,
    processMetrics(
      { identity, transfers: runtime.transfers, diagnostics, ...services.metricSources },
      () => drain.activeRequests,
      { certificate: parts.certificate, replica: parts.replica, catalog: runtime.catalog },
    ),
    () => performance.now(),
  );
}

/** What the registrations below share with createServer. */
interface RouteParts {
  readonly config: ServerConfig;
  readonly runtime: ApiRuntime;
  readonly services: ReturnType<typeof createApiServices>;
  readonly context: ReturnType<typeof createRequestContext>;
  readonly replica: ReturnType<typeof replicaGuardFor>;
  readonly drain: RequestDrain;
  readonly identity: ProcessIdentity;
  readonly recentLog: ReturnType<typeof processLog>['recentLog'];
  readonly policy: ReturnType<typeof resolveUploadTimeouts>;
  readonly diagnostics: DiagnosticLogger;
  readonly fleetTrust: PostgresFleetTrust;
}

/** Routes after the security hooks: errors, health, updates, feedback, the API and the console. */
function registerRoutes(app: FastifyInstance, parts: RouteParts) {
  const { config, runtime, services, context, replica, drain } = parts;
  registerReplicaGuard(app, replica);
  registerHttpErrors(app, context);
  registerHealthRoutes(app, runtime, () => drain.isDraining, replica, context.principal);
  registerUpdateRoutes(app, context.principal, config.updateControlDirectory);
  registerFleetRoutes(app, context.principal, {
    trust: parts.fleetTrust,
    name: config.siteName ?? 'arkvory',
    version: parts.identity.version,
  });
  registerTopologyRoutes(app, context.principal, {
    siteName: config.siteName ?? 'arkvory',
    version: parts.identity.version,
    role: runtime.role,
    available: runtime.available,
    draining: () => drain.isDraining,
    replica,
    mirrors: services.mirrors,
    updates: new UpdateControl(config.updateControlDirectory),
    downloads: runtime.transfers.downloadScheduler,
    pool: runtime.catalog.pool,
  });
  registerFeedback(app, context.principal, {
    hub: config.hub ?? null,
    version: parts.identity.version,
    log: parts.recentLog,
    mirrors: services.mirrors,
    updates: new UpdateControl(config.updateControlDirectory),
  });
  registerApiRoutes(app, {
    services,
    context,
    transfers: runtime.transfers,
    available: runtime.available,
    role: runtime.role,
    policy: parts.policy,
    diagnostics: parts.diagnostics,
  });
  if (runtime.role === 'api') registerConsole(app, config.webDirectory ?? 'apps/web/public');
}

export async function createServer(config: ServerConfig, lifecycle: ServerLifecycle = {}) {
  const policy = resolveUploadTimeouts(config);
  const tls = await prepareTls(config);
  const app = createHttpServer({ trustedProxies: config.trustedProxies ?? [], ...tls.options });
  const runtime = new ApiRuntime(config);
  const drain = lifecycle.drain ?? new RequestDrain();
  drain.onBegin(runtime.transfers.drain);
  if (lifecycle.onOwnershipLost)
    registerOwnershipRecovery(app, runtime.available, lifecycle.onOwnershipLost);
  const identity = lifecycle.identity ?? processIdentity('api', 'dev');
  const { diagnostics, recentLog } = processLog(config, lifecycle, identity);
  // Only a logger created here is closed here; a caller's logger outlives the server.
  const closeDiagnostics = () => {
    if (diagnostics !== lifecycle.diagnostics) diagnostics.close();
  };
  const certificate = tls.attach(app, diagnostics);
  let background: ReturnType<typeof registerBackgroundTasks> | undefined;
  app.addHook('preClose', async () => {
    // Refuse new work and interrupt transfers before draining tasks that still need the pool.
    runtime.stop();
    await background?.stop();
  });
  app.addHook('onClose', async () => {
    closeDiagnostics();
    await runtime.close();
  });
  try {
    await runtime.start();
    const services = createApiServices(runtime.catalog, runtime.blobs, runtime.pins, {
      allowRegistration: config.allowRegistration ?? false,
      ...(config.maxObjectBytes === undefined ? {} : { maxObjectBytes: config.maxObjectBytes }),
      ...(config.mirrors ? { mirrors: config.mirrors } : {}),
    });
    const context = createRequestContext(config.maxRequests, services.mirrors.readOnlyRepositories);
    const replica = replicaGuardFor(config.replicaSocket, runtime.role);
    const fleetTrust = new PostgresFleetTrust(runtime.catalog.pool);
    const responses = new ResponseDiagnostics(diagnostics, services.storagePolicies, context);
    // Guard registration precedes feature routes and background startup.
    registerContractGuard(app);
    // Collects routes like the guard does, for the 405 Allow answer of unmatched requests.
    registerNotFound(app, context, runtime.role);
    registerObservation(app, {
      config,
      runtime,
      services,
      context,
      replica,
      drain,
      identity,
      diagnostics,
      certificate,
      fleetTrust,
    });
    registerCors(app, config.corsOrigins ?? []);
    background = registerMaintenance(app, runtime, services, responses, diagnostics);
    app.addHook('onResponse', async (request, reply) => {
      responses.record(request, reply);
    });
    registerRequestSecurity(app, {
      config,
      context,
      role: runtime.role,
      available: runtime.available,
      identity: services.identity,
      serviceAccounts: services.serviceAccounts,
      links: services.links,
      fleet: fleetTrust,
      registerOwner: runtime.transfers.registerOwner,
      drain,
    });
    registerRoutes(app, {
      config,
      runtime,
      services,
      context,
      replica,
      drain,
      identity,
      recentLog,
      policy,
      diagnostics,
      fleetTrust,
    });
    return await app;
  } catch (error) {
    // Route/configuration failures after acquiring ownership must not strand pools or leases.
    try {
      await app.close();
    } finally {
      closeDiagnostics();
      await runtime.close();
    }
    throw error;
  }
}

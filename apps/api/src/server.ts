import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  DiagnosticLogger,
  FleetSeal,
  HttpFleetSiteClient,
  PostgresFleetRegistry,
  PostgresFleetTrust,
  loadInstallation,
  processIdentity,
} from '@proanima/arkvory-infrastructure';
import { allowResolutionUnder, resolutionConfined } from '@proanima/arkvory-resolution';
import type { FleetControl } from '@proanima/arkvory-application';
import { createFleetControl, registerFleetControlRoutes } from './fleet-control-routes.js';
import type { PostgresCatalog, ProcessIdentity } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import { ApiRuntime, gatewayRole } from './api-runtime.js';
import type { ApiModuleContext } from './modules.js';
import { createApiServices } from './api-services.js';
import { registerApiRoutes } from './api-routes.js';
import { registerEventRoutes } from './event-routes.js';
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
import { registerDownloadSettingsRoutes } from './download-settings-routes.js';
import { registerSiteChangeRoutes } from './site-change-routes.js';
import { SiteChangeControl } from './site-change-control.js';
import { UpdateControl } from './update-control.js';
import { registerFeedback } from './feedback-routes.js';
import { collectTopology, registerTopologyRoutes, type TopologyParts } from './topology-routes.js';
import { FleetOverviewSource } from './fleet-overview.js';
import { registerFleetRoutes } from './fleet-routes.js';
import { registerModuleRoutes } from './module-routes.js';
import { registerExtensionDocuments } from './extension-documents.js';
import { declaredRoutes } from './extension-routes.js';
import { moduleMetrics } from './module-metrics.js';
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
  fleet: FleetControl,
) {
  services.storageMetrics.bind((record) => {
    diagnostics.write(record);
  });
  return registerBackgroundTasks(app, {
    role: runtime.role,
    available: runtime.available,
    fleet: (signal) => fleet.pollAll(signal),
    settings: () => runtime.downloadSettings.sync(),
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
    storage: () =>
      runtime.probeStorage((id, fault) => {
        services.storageMetrics.changed(id, fault);
      }),
    flush: () => responses.flush(),
    close: () => {
      responses.close();
    },
    diagnostics,
  });
}

/** Process clocks and sizes of the metrics; the server passes only its own sources. */
function processMetrics(
  sources: Pick<
    MetricSources,
    'identity' | 'transfers' | 'diagnostics' | 'jobs' | 'backup' | 'fleet' | 'modules'
  >,
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
 * The process log and the runtime, whose modules write to it. Module settings and the plan are
 * refused while the runtime is built, before any pool or storage exists; a logger created here
 * is then closed again. Only a logger created here is closed here; a caller's outlives the server.
 */
async function processRuntime(
  config: ServerConfig,
  lifecycle: ServerLifecycle,
  identity: ProcessIdentity,
) {
  const { diagnostics, recentLog } = processLog(config, lifecycle, identity);
  const closeDiagnostics = () => {
    if (diagnostics !== lifecycle.diagnostics) diagnostics.close();
  };
  try {
    // Installed signed modules are checked and their code imported before any pool or storage.
    const installation = await loadInstallation<ApiModuleContext>({
      role: gatewayRole(config),
      coreVersion: identity.version,
      selections: config.modules ?? new Map(),
      installed: config.installedModules,
      // The entry confined resolution to the release; a verified package joins it (ADR 0031).
      admit: (directory) => {
        if (resolutionConfined()) allowResolutionUnder(directory);
      },
      now: Date.now(),
    });
    const runtime = new ApiRuntime(config, identity.version, diagnostics, installation);
    for (const module of installation.refused)
      diagnostics.write({
        level: module.enabled ? 'warning' : 'info',
        component: 'module',
        code: 'module.refused',
        module: module.id,
        errorCode: module.code,
      });
    return { diagnostics, recentLog, closeDiagnostics, runtime };
  } catch (error) {
    closeDiagnostics();
    throw error;
  }
}

/** One line per signed module that should run in this process but could not start here. */
function reportModuleFailures(runtime: ApiRuntime, diagnostics: DiagnosticLogger) {
  for (const { module, running, health } of runtime.modules.states())
    if (!running && health?.status === 'failed')
      diagnostics.write({
        level: 'warning',
        component: 'module',
        code: 'module.failed',
        module: module.manifest.id,
        errorCode: health.code ?? 'failed',
      });
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
      {
        identity,
        transfers: runtime.transfers,
        diagnostics,
        ...services.metricSources,
        ...(parts.fleetOverview ? { fleet: parts.fleetOverview } : {}),
        modules: moduleMetrics(runtime.modules, runtime.telemetry),
      },
      () => drain.activeRequests,
      { certificate: parts.certificate, replica: parts.replica, catalog: runtime.catalog },
    ),
    () => performance.now(),
  );
}

/** What this installation reports of itself: the topology route and the fleet overview. */
function topologyParts(
  parts: Pick<RouteParts, 'config' | 'runtime' | 'services' | 'replica' | 'drain' | 'identity'>,
): TopologyParts {
  return {
    siteName: parts.config.siteName ?? 'arkvory',
    version: parts.identity.version,
    role: parts.runtime.role,
    available: parts.runtime.available,
    draining: () => parts.drain.isDraining,
    replica: parts.replica,
    mirrors: parts.services.mirrors,
    updates: new UpdateControl(parts.config.updateControlDirectory),
    downloads: parts.runtime.transfers.downloadScheduler,
    pool: parts.runtime.catalog.pool,
  };
}

/** The controller's overview of its sites (stage F4); read gateways manage no sites. */
function fleetOverviewFor(
  parts: Pick<
    RouteParts,
    'config' | 'runtime' | 'services' | 'replica' | 'drain' | 'identity' | 'fleetControl'
  >,
): FleetOverviewSource | undefined {
  if (parts.runtime.role !== 'api') return undefined;
  const self = topologyParts(parts);
  return new FleetOverviewSource(parts.fleetControl, () => collectTopology(self), {
    name: parts.config.siteName ?? 'arkvory',
    version: parts.identity.version,
    url: parts.config.siteUrl ?? null,
    lagLimit: parts.config.fleetLagAlert ?? 1000n,
    now: Date.now,
    monotonic: () => performance.now(),
  });
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
  readonly fleetControl: FleetControl;
  readonly fleetOverview: FleetOverviewSource | undefined;
}

/** The controller side of ADR 0077; the writer keeps the seal key, read gateways manage no sites. */
async function fleetControlFor(config: ServerConfig, runtime: ApiRuntime): Promise<FleetControl> {
  return createFleetControl({
    store: new PostgresFleetRegistry(runtime.catalog.pool),
    client: new HttpFleetSiteClient(),
    seal:
      runtime.role === 'api'
        ? await FleetSeal.loadOrCreate(
            config.fleetKeyFile ?? join(config.dataDirectory, 'fleet.key'),
          )
        : undefined,
    controllerName: config.siteName ?? 'arkvory',
  });
}

/** Routes after the security hooks: errors, health, updates, feedback, the API and the console. */
function registerRoutes(app: FastifyInstance, parts: RouteParts) {
  const { config, runtime, services, context, replica, drain } = parts;
  registerReplicaGuard(app, replica);
  registerHttpErrors(app, context);
  registerHealthRoutes(app, runtime, () => drain.isDraining, replica, context.principal);
  registerUpdateRoutes(app, context.principal, config.updateControlDirectory);
  registerDownloadSettingsRoutes(app, context.principal, runtime.downloadSettings);
  registerSiteChangeRoutes(
    app,
    context.principal,
    new SiteChangeControl(config.updateControlDirectory),
  );
  registerFleetControlRoutes(app, context, parts.fleetControl, parts.fleetOverview);
  registerFleetRoutes(app, context.principal, {
    trust: parts.fleetTrust,
    name: config.siteName ?? 'arkvory',
    version: parts.identity.version,
    ...(config.tls ? { certificateFile: config.tls.certificateFile } : {}),
  });
  registerTopologyRoutes(app, context.principal, topologyParts(parts));
  registerEventRoutes(app, services.events, context, config.siteName ?? 'arkvory');
  registerModuleRoutes(app, context.principal, runtime.modules);
  const { sets } = runtime.extensions();
  registerExtensionDocuments(app, context.principal, {
    role: runtime.role,
    fingerprint: runtime.modules.plan.fingerprint,
    sets,
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
    // Modules with a public surface (ADR 0079, section 9): a storage has none for clients, and
    // a signed module that failed to start here has none either.
    modules: runtime.modules
      .states()
      .filter(({ running, module }) => running && module.manifest.kind !== 'storage-backend')
      .map(({ module }) => ({ id: module.manifest.id, kind: module.manifest.kind })),
    extensions: sets,
    scopes: (module) => runtime.hostServices.scopes(module),
  });
  if (runtime.role === 'api') registerConsole(app, config.webDirectory ?? 'apps/web/public');
}

export async function createServer(config: ServerConfig, lifecycle: ServerLifecycle = {}) {
  const policy = resolveUploadTimeouts(config);
  const tls = await prepareTls(config);
  const app = createHttpServer({ trustedProxies: config.trustedProxies ?? [], ...tls.options });
  const identity = lifecycle.identity ?? processIdentity('api', 'dev');
  const { diagnostics, recentLog, closeDiagnostics, runtime } = await processRuntime(
    config,
    lifecycle,
    identity,
  );
  const drain = lifecycle.drain ?? new RequestDrain();
  drain.onBegin(runtime.transfers.drain);
  if (lifecycle.onOwnershipLost)
    registerOwnershipRecovery(app, runtime.available, lifecycle.onOwnershipLost);
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
    reportModuleFailures(runtime, diagnostics);
    const services = createApiServices(runtime.catalog, runtime.blobs, runtime.pins, {
      staging: runtime.staging,
      allowRegistration: config.allowRegistration ?? false,
      ...(config.maxObjectBytes === undefined ? {} : { maxObjectBytes: config.maxObjectBytes }),
      ...(config.mirrors ? { mirrors: config.mirrors } : {}),
    });
    const context = createRequestContext(config.maxRequests, services.mirrors.readOnlyRepositories);
    const replica = replicaGuardFor(config.replicaSocket, runtime.role);
    const fleetTrust = new PostgresFleetTrust(runtime.catalog.pool);
    const fleetControl = await fleetControlFor(config, runtime);
    const fleet = { config, runtime, services, replica, drain, identity, fleetControl };
    const fleetOverview = fleetOverviewFor(fleet);
    const responses = new ResponseDiagnostics(diagnostics, services.storagePolicies, context);
    // Guard registration precedes feature routes and background startup.
    const extensions = runtime.extensions();
    registerContractGuard(app, extensions.modules, declaredRoutes(extensions.sets));
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
      fleetControl,
      fleetOverview,
    });
    registerCors(app, config.corsOrigins ?? []);
    background = registerMaintenance(app, runtime, services, responses, diagnostics, fleetControl);
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
      fleetControl,
      fleetOverview,
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

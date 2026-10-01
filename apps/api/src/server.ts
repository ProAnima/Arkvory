import { DiagnosticLogger, processIdentity } from '@proanima/arkvory-infrastructure';
import type { ProcessIdentity } from '@proanima/arkvory-infrastructure';
import type { ServerConfig } from './config.js';
import { ApiRuntime } from './api-runtime.js';
import { createApiServices } from './api-services.js';
import { registerApiRoutes } from './api-routes.js';
import { createHttpServer } from './http-server.js';
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
import { registerOwnershipRecovery } from './ownership-recovery.js';
import { registerAccessLog } from './access-log.js';
import { RequestDrain } from './drain.js';
import { ApiMetrics, registerMetrics } from './api-metrics.js';

export interface ServerLifecycle {
  onOwnershipLost?: () => void;
  drain?: RequestDrain;
  /** Process logger owned by the caller, which closes it after the server; else one is created. */
  diagnostics?: DiagnosticLogger;
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
        );
      } finally {
        // Bounded batch; the security journal must not grow without limit under login floods.
        if (runtime.available()) await services.securityAudit.prune();
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

export async function createServer(config: ServerConfig, lifecycle: ServerLifecycle = {}) {
  const policy = resolveUploadTimeouts(config);
  const app = createHttpServer({ trustedProxies: config.trustedProxies ?? [] });
  const runtime = new ApiRuntime(config);
  const drain = lifecycle.drain ?? new RequestDrain();
  drain.onBegin(runtime.transfers.drain);
  if (lifecycle.onOwnershipLost)
    registerOwnershipRecovery(app, runtime.available, lifecycle.onOwnershipLost);
  const identity = lifecycle.identity ?? processIdentity('api', 'dev');
  const diagnostics =
    lifecycle.diagnostics ??
    new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
      level: config.logLevel ?? 'info',
      process: identity,
    });
  // Only a logger created here is closed here; a caller's logger outlives the server.
  const closeDiagnostics = () => {
    if (diagnostics !== lifecycle.diagnostics) diagnostics.close();
  };
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
    });
    const context = createRequestContext(config.maxRequests);
    const responses = new ResponseDiagnostics(diagnostics, services.storagePolicies, context);
    // Guard registration precedes feature routes and background startup.
    registerContractGuard(app);
    // Collects routes like the guard does, for the 405 Allow answer of unmatched requests.
    registerNotFound(app, context, runtime.role);
    // loadConfig enables it by default; embedded/test servers opt in explicitly.
    if (config.accessLog === true)
      registerAccessLog(app, {
        writer: diagnostics,
        principal: context.peekPrincipal,
        now: () => performance.now(),
      });
    // Observes every response, including rejections by the security hooks registered below.
    registerMetrics(
      app,
      new ApiMetrics({
        identity,
        transfers: runtime.transfers,
        activeRequests: () => drain.activeRequests,
        diagnostics,
        jobs: services.jobs,
        now: () => performance.now(),
        startedAtSeconds: Math.round(Date.now() / 1000 - process.uptime()),
        residentMemory: () => process.memoryUsage.rss(),
      }),
      () => performance.now(),
    );
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
      registerOwner: runtime.transfers.registerOwner,
      drain,
    });
    registerHttpErrors(app, context);
    registerHealthRoutes(app, runtime, () => drain.isDraining);
    registerUpdateRoutes(app, context.principal, config.updateControlDirectory);
    registerApiRoutes(app, {
      services,
      context,
      transfers: runtime.transfers,
      available: runtime.available,
      role: runtime.role,
      policy,
      diagnostics,
    });
    if (runtime.role === 'api') registerConsole(app, config.webDirectory ?? 'apps/web/public');
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

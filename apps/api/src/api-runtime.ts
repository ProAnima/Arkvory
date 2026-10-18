import {
  dataVolumeStaging,
  defaultStorageReserveBytes,
  DownloadTickets,
  localStorageBackends,
  loadDownloadTicketKey,
  PostgresStorageIdentities,
  probeStorageBackends,
  PostgresCatalog,
  PostgresDownloadLease,
  PostgresContentPins,
  PostgresDownloadSettings,
  PostgresModulePlan,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticRecord,
  InstallationPlan,
  ModuleHostServices,
  StagingArea,
  StorageBackends,
  StorageFault,
  StorageLifecycle,
} from '@proanima/arkvory-infrastructure';
import { DownloadSettingsControl } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ServerConfig } from './config.js';
import { createTransferControls } from './transfer-controls.js';
import { apiModules, planApiModules, type ApiModuleContext } from './modules.js';
import type { ModuleRuntime } from './module-host.js';
import { ModuleTelemetry } from './module-telemetry.js';
import { apiHostServices } from './module-services.js';

export function gatewayRole(config: ServerConfig): 'api' | 'reader' {
  const role: unknown = config.role ?? 'api';
  if (role !== 'api' && role !== 'reader') throw new Error('Invalid gateway role');
  if (
    (role === 'reader' && !config.sharedDownloads) ||
    (config.sharedDownloads && (role === 'api') !== (config.sharedDownloads.slot === 0))
  )
    throw new Error('Shared downloads require writer slot zero and distinct reader slots');
  return role;
}

/** How often a process without the ticket key looks for it again. */
const TICKET_KEY_RETRY_MS = 30_000;
/** Shared drain budget of the modules at close (ADR 0079, section 4). */
const MODULE_DRAIN_BUDGET_MS = 10_000;

/** Owns process resources, including cleanup after partial startup. */
export class ApiRuntime {
  readonly role;
  readonly transfers;
  readonly catalog: PostgresCatalog;
  /** Every storage of the installation behind one port (ADR 0083, N11). */
  readonly blobs: StorageBackends;
  /** The core's storage `default`: readiness, ownership and the reserve of the data volume. */
  readonly core: StorageLifecycle;
  /** Temporary files of raw and OCI uploads, on the data volume beside the content. */
  readonly staging: StagingArea;
  readonly pins: PostgresContentPins;
  readonly lease: PostgresDownloadLease | undefined;
  readonly downloadSettings: DownloadSettingsControl;
  private closing: Promise<void> | undefined;
  private stopped = false;
  private ticketRetry: ReturnType<typeof setInterval> | undefined;
  /** The modules of this process (ADR 0079); planned at construction, started last by `start`. */
  readonly modules: ModuleRuntime<ApiModuleContext>;
  /** The modules' log and metrics, bound to the process log. */
  readonly telemetry: ModuleTelemetry;
  /** The plan the writer records and read gateways compare with theirs. */
  private readonly modulePlan: PostgresModulePlan;
  /** What the core gives modules (ADR 0083); built after the pools, used at module create. */
  readonly hostServices: ModuleHostServices;

  constructor(
    config: ServerConfig,
    /** Release version of the core: the version of built-in modules and part of their plan. */
    coreVersion: string,
    /** The process log; modules write to it through their telemetry. */
    log: { write(record: DiagnosticRecord): void } = { write: () => undefined },
    /** The loaded modules (`loadInstallation`); absent, the built-in modules alone. */
    installation?: InstallationPlan<ApiModuleContext>,
  ) {
    this.role = gatewayRole(config);
    this.telemetry = new ModuleTelemetry(log, () => performance.now());
    // Module settings and the plan are checked before any pool, storage or timer exists.
    this.modules = installation
      ? apiModules(this.role, installation, this.telemetry, (module, resources) =>
          this.hostServices.for(module, resources),
        )
      : planApiModules(this.role, coreVersion, config.modules, this.telemetry);
    // Validate local limits before allocating pools or claiming ownership.
    this.transfers = createTransferControls(config, this.available);
    this.blobs = localStorageBackends(
      config.dataDirectory,
      config.storageReserveBytes ?? defaultStorageReserveBytes,
      config.storageBackends ?? [],
      config.storageReserveInodes === undefined
        ? {}
        : { reserveInodes: config.storageReserveInodes },
    );
    this.core = this.blobs.core.lifecycle;
    this.staging = dataVolumeStaging(config.dataDirectory, (bytes) => this.core.checkSpace(bytes));
    this.catalog = new PostgresCatalog(
      config.databaseUrl,
      config.capacityBytes,
      config.maxUploads,
      config.databasePoolSize ?? 20,
    );
    this.pins = new PostgresContentPins(this.catalog.sessions);
    this.hostServices = apiHostServices(config, this.role, this);
    this.modulePlan = new PostgresModulePlan(this.catalog.pool);
    this.lease = config.sharedDownloads
      ? new PostgresDownloadLease(this.catalog.sessions, config.sharedDownloads)
      : undefined;
    // Saved queue settings run on writers; read gateways keep their environment until the
    // shared queue of ADR 0076 stage 4, as their queues are per process.
    const scheduler = this.transfers.downloadScheduler;
    this.downloadSettings = new DownloadSettingsControl(
      new PostgresDownloadSettings(this.catalog.pool),
      scheduler.policy,
      this.role === 'api' ? scheduler : { configure: () => undefined },
      { applies: this.role === 'api', gateways: config.sharedDownloads !== undefined },
    );
  }

  readonly available = () => !this.stopped && this.catalog.active && (this.lease?.active ?? true);

  /**
   * Readiness of the modules (ADR 0079, sections 3 and 4): no failed module that the process
   * cannot do without and, on a read gateway, the plan the writer recorded.
   */
  readonly modulesReady = async (): Promise<void> => {
    if (this.modules.blockingFailure() !== null)
      throw new ArkvoryError('unavailable', 'A required module failed', {
        reason: 'module_failed',
      });
    // The compatibility fingerprint, not the full one: a gateway of the previous release serves
    // beside an updated writer with the same modules, as an update without a migration allows.
    if (
      this.role === 'reader' &&
      (await this.modulePlan.read())?.compatibilityFingerprint !==
        this.modules.plan.compatibilityFingerprint
    )
      throw new ArkvoryError('unavailable', 'The module plan differs from the writer', {
        reason: 'module_plan_mismatch',
      });
  };

  async start(): Promise<void> {
    try {
      if (this.role === 'reader') await this.core.ready();
      else await this.core.initialize();
      await this.catalog.ready();
      await this.catalog.claimStorage(
        await this.core.identity(this.role === 'reader'),
        this.role,
        this.lease !== undefined,
      );
      await this.lease?.start();
      // One plan per installation (ADR 0079, section 3): the storage owner records it, and read
      // gateways and the worker with another plan are not ready until they are restarted.
      if (this.role === 'api') await this.modulePlan.record(this.modules.plan);
      // Storages other than `default` open once ownership is held; one that fails leaves the
      // process running with that storage unavailable (ADR 0078, L5).
      await this.probeStorage();
      // Queue tickets keep a download's turn over a restart (ADR 0076); a reader without a key
      // made by a writer yet issues none until a later look finds it.
      // A database hiccup here only delays tickets, as the retry below would.
      if (!(await this.loadTicketKey().catch(() => false))) this.retryTicketKey();
      // The environment runs until the record is read: a database hiccup here must not stop the
      // start, the background task retries every 10 seconds and reports a failure.
      if (this.role === 'api') await this.downloadSettings.sync().catch(() => undefined);
      await this.modules.start();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Opens or rechecks the storages other than `default`: at start and then periodically. Only
   * the writer records the identity of a storage it sees first.
   */
  probeStorage(changed?: (id: string, fault: StorageFault | null) => void): Promise<void> {
    return probeStorageBackends(this.blobs, new PostgresStorageIdentities(this.catalog.pool), {
      create: this.role === 'api',
      ...(changed ? { changed } : {}),
    });
  }

  private async loadTicketKey() {
    const key = await loadDownloadTicketKey(this.catalog.pool, this.role === 'api');
    if (key && !this.stopped) this.transfers.downloadScheduler.useTickets(new DownloadTickets(key));
    return key !== undefined;
  }

  /** Looks for the key periodically; one look at a time, ended by success or `stop`. */
  private retryTicketKey() {
    if (this.stopped) return;
    let looking = false;
    this.ticketRetry = setInterval(() => {
      if (looking || this.stopped) return;
      looking = true;
      this.loadTicketKey()
        .then((found) => {
          if (found) clearInterval(this.ticketRetry);
        })
        // A database hiccup only delays tickets: the next look tries again.
        .catch(() => undefined)
        .finally(() => {
          looking = false;
        });
    }, TICKET_KEY_RETRY_MS);
    this.ticketRetry.unref();
  }

  stop(): void {
    this.stopped = true;
    this.modules.cancelStart();
    clearInterval(this.ticketRetry);
    this.transfers.close();
    this.lease?.close();
  }

  close(): Promise<void> {
    this.stop();
    // Startup rollback, Fastify onClose and explicit close may converge here.
    this.closing ??= this.release();
    return this.closing;
  }

  private async release(): Promise<void> {
    try {
      // Modules drain and stop before the pools they may use close (ADR 0079, section 4); a
      // module start still running is cancelled and settles first.
      await this.modules.shutdown(MODULE_DRAIN_BUDGET_MS);
    } finally {
      this.hostServices.close();
      await this.pins.close();
      await this.catalog.close();
    }
  }
}

import {
  DownloadTickets,
  LocalBlobStore,
  loadDownloadTicketKey,
  PostgresCatalog,
  PostgresDownloadLease,
  PostgresContentPins,
  PostgresDownloadSettings,
} from '@proanima/arkvory-infrastructure';
import { DownloadSettingsControl } from '@proanima/arkvory-application';
import type { ServerConfig } from './config.js';
import { createTransferControls } from './transfer-controls.js';

function gatewayRole(config: ServerConfig): 'api' | 'reader' {
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

/** Owns process resources, including cleanup after partial startup. */
export class ApiRuntime {
  readonly role;
  readonly transfers;
  readonly catalog: PostgresCatalog;
  readonly blobs: LocalBlobStore;
  readonly pins: PostgresContentPins;
  readonly lease: PostgresDownloadLease | undefined;
  readonly downloadSettings: DownloadSettingsControl;
  private closing: Promise<void> | undefined;
  private stopped = false;
  private ticketRetry: ReturnType<typeof setInterval> | undefined;

  constructor(config: ServerConfig) {
    this.role = gatewayRole(config);
    // Validate local limits before allocating pools or claiming ownership.
    this.transfers = createTransferControls(config, this.available);
    this.blobs = new LocalBlobStore(config.dataDirectory, config.storageReserveBytes);
    this.catalog = new PostgresCatalog(
      config.databaseUrl,
      config.capacityBytes,
      config.maxUploads,
      config.databasePoolSize ?? 20,
    );
    this.pins = new PostgresContentPins(this.catalog.sessions);
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

  async start(): Promise<void> {
    try {
      if (this.role === 'reader') await this.blobs.ready();
      else await this.blobs.initialize();
      await this.catalog.ready();
      await this.catalog.claimStorage(
        await this.blobs.identity(this.role === 'reader'),
        this.role,
        this.lease !== undefined,
      );
      await this.lease?.start();
      // Queue tickets keep a download's turn over a restart (ADR 0076); a reader without a key
      // made by a writer yet issues none until a later look finds it.
      if (!(await this.loadTicketKey())) this.retryTicketKey();
      // The environment runs until the record is read: a database hiccup here must not stop the
      // start, the background task retries every 10 seconds and reports a failure.
      if (this.role === 'api') await this.downloadSettings.sync().catch(() => undefined);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async loadTicketKey() {
    const key = await loadDownloadTicketKey(this.catalog.pool, this.role === 'api');
    if (key && !this.stopped) this.transfers.downloadScheduler.useTickets(new DownloadTickets(key));
    return key !== undefined;
  }

  /** Looks for the key periodically; one look at a time, ended by success or `stop`. */
  private retryTicketKey() {
    let looking = false;
    this.ticketRetry = setInterval(() => {
      if (looking) return;
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
    clearInterval(this.ticketRetry);
    this.transfers.close();
    this.lease?.close();
  }

  close(): Promise<void> {
    this.stop();
    // Startup rollback, Fastify onClose and explicit close may converge here.
    this.closing ??= this.pins.close().then(() => this.catalog.close());
    return this.closing;
  }
}

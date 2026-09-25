import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresDownloadLease,
} from '@proanima/depot-infrastructure';
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

/** Owns process resources, including cleanup after partial startup. */
export class ApiRuntime {
  readonly role;
  readonly transfers;
  readonly catalog: PostgresCatalog;
  readonly blobs: LocalBlobStore;
  readonly lease: PostgresDownloadLease | undefined;
  private closing: Promise<void> | undefined;
  private stopped = false;

  constructor(config: ServerConfig) {
    this.role = gatewayRole(config);
    // Validate local limits before allocating pools or claiming ownership.
    this.transfers = createTransferControls(config, this.available);
    this.blobs = new LocalBlobStore(config.dataDirectory);
    this.catalog = new PostgresCatalog(config.databaseUrl, config.capacityBytes, config.maxUploads);
    this.lease = config.sharedDownloads
      ? new PostgresDownloadLease(this.catalog.pool, config.sharedDownloads)
      : undefined;
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
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  stop(): void {
    this.stopped = true;
    this.transfers.close();
    this.lease?.close();
  }

  close(): Promise<void> {
    this.stop();
    // Startup rollback, Fastify onClose and explicit close may converge here.
    this.closing ??= this.catalog.close();
    return this.closing;
  }
}

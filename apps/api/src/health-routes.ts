import type { FastifyInstance } from 'fastify';
import { DepotError } from '@proanima/depot-domain';
import { readinessSchema } from '@proanima/depot-contracts';
import type {
  LocalBlobStore,
  PostgresCatalog,
  PostgresDownloadLease,
  AdmissionQueue,
  BandwidthGovernor,
} from '@proanima/depot-infrastructure';

interface Health {
  catalog: Pick<PostgresCatalog, 'ready'>;
  blobs: Pick<LocalBlobStore, 'ready' | 'checkSpace'>;
  role: 'api' | 'reader';
  lease: Pick<PostgresDownloadLease, 'snapshot'> | undefined;
  available: () => boolean;
  transfers: {
    uploadGate: Pick<AdmissionQueue, 'snapshot'>;
    downloadGate: Pick<AdmissionQueue, 'snapshot'>;
    uploadBandwidth: Pick<BandwidthGovernor, 'snapshot'>;
    downloadBandwidth: Pick<BandwidthGovernor, 'snapshot'>;
  };
}
export function registerHealthRoutes(app: FastifyInstance, dependencies: Health) {
  const { catalog, blobs, role, lease, available } = dependencies;
  const { uploadGate, downloadGate, uploadBandwidth, downloadBandwidth } = dependencies.transfers;
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
}

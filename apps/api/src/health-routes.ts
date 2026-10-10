import type { FastifyInstance } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { readinessSchema, healthStatusSchema } from '@proanima/arkvory-contracts';
import type {
  LocalBlobStore,
  PostgresCatalog,
  PostgresDownloadLease,
  AdmissionQueue,
  BandwidthGovernor,
} from '@proanima/arkvory-infrastructure';
import { ReadinessProbe } from './readiness.js';
import type { ReplicaGuard } from './replica-guard.js';

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
export function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: Health,
  draining: () => boolean,
  replica?: ReplicaGuard,
) {
  const { catalog, blobs, role, lease, available } = dependencies;
  const { uploadGate, downloadGate, uploadBandwidth, downloadBandwidth } = dependencies.transfers;
  const probe = new ReadinessProbe(
    async () => {
      await catalog.ready();
      await blobs.ready();
      if (!available()) throw new ArkvoryError('unavailable', 'Gateway ownership lost');
    },
    draining,
    () => performance.now(),
  );
  app.get('/health/live', () => Promise.resolve({ status: 'ok' }));
  // Public and detail-free: load balancers need only the HTTP status and this enum.
  app.get(
    '/health/status',
    { schema: { response: { 200: healthStatusSchema, 503: healthStatusSchema } } },
    async (_request, reply) => {
      const status = await probe.status();
      if (status !== 'ready') void reply.code(503).header('Retry-After', '2');
      return { status };
    },
  );
  app.get('/health/ready', { schema: { response: { 200: readinessSchema } } }, async () => {
    if (draining()) throw new ArkvoryError('unavailable', 'Server is draining');
    await catalog.ready();
    await blobs.ready();
    let writable = role === 'api';
    try {
      if (writable) await blobs.checkSpace(0);
    } catch (error) {
      if (error instanceof ArkvoryError && error.code === 'capacity_exceeded') writable = false;
      else throw error;
    }
    if (!available())
      throw new ArkvoryError('unavailable', 'Gateway ownership or download lease lost');
    // Missing copies stop writes, not the node: readiness stays 200 so the cluster manager
    // does not move a healthy writer, and writable says whether writes are acknowledged.
    if (replica) await replica.refresh();
    const replication = replica ? (replica.snapshot ?? null) : undefined;
    if (replica && (!replication || replication.copies < replication.required)) writable = false;
    return {
      status: 'ready',
      writable,
      ...(replication === undefined ? {} : { replication }),
      role,
      sharedDownloads: lease?.snapshot ?? null,
      transfers: {
        uploads: { admission: uploadGate.snapshot, bandwidth: uploadBandwidth.snapshot },
        downloads: { admission: downloadGate.snapshot, bandwidth: downloadBandwidth.snapshot },
      },
    };
  });
}

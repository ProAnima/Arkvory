import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { retentionObject, requireAdministrator } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { MirrorStatus } from '@proanima/arkvory-application';
import { topologySchema, type SiteTopology } from '@proanima/arkvory-contracts';
import { SCHEMA_VERSION, type DownloadScheduler } from '@proanima/arkvory-infrastructure';
import type { ReplicaGuard } from './replica-guard.js';
import type { UpdateControl } from './update-control.js';

export interface TopologyParts {
  readonly siteName: string;
  readonly version: string;
  readonly role: 'api' | 'reader';
  readonly available: () => boolean;
  readonly draining: () => boolean;
  readonly replica: Pick<ReplicaGuard, 'snapshot'> | undefined;
  readonly mirrors: Pick<MirrorStatus, 'all'>;
  readonly updates: Pick<UpdateControl, 'status'>;
  readonly downloads: Pick<DownloadScheduler, 'snapshot'>;
  readonly pool: Pick<Pool, 'query'>;
}

/** Read gateways of the installation from their leases (ADR 0009): a slot and whether it is held. */
async function gateways(pool: Pick<Pool, 'query'>) {
  const rows = await pool.query<{ slot: number; active: boolean; expires_at: Date }>(
    `SELECT slot, expires_at > clock_timestamp() AS active, expires_at
     FROM arkvory_gateway_leases ORDER BY slot LIMIT 16`,
  );
  return rows.rows.map((row) => ({
    slot: row.slot,
    active: row.active,
    expiresAt: row.expires_at.toISOString(),
  }));
}

/** Changes of the source a mirror has not applied: the head it last saw minus its cursor. */
function lag(head: string | null, cursor: string): string | null {
  if (head === null) return null;
  const behind = BigInt(head) - BigInt(cursor);
  return behind > 0n ? behind.toString() : '0';
}

/** What this installation reports of itself; the fleet overview reads it too (stage F4). */
export async function collectTopology(parts: TopologyParts): Promise<SiteTopology> {
  const [snapshot, mirrors, leases] = await Promise.all([
    parts.updates.status().catch(() => ({ snapshot: null })),
    parts.mirrors.all(),
    gateways(parts.pool),
  ]);
  const replication = parts.replica ? (parts.replica.snapshot ?? null) : null;
  const updates = snapshot.snapshot;
  const queue = parts.downloads.snapshot;
  return {
    collectedAt: new Date().toISOString(),
    site: {
      name: parts.siteName,
      version: parts.version,
      schema: SCHEMA_VERSION,
      role: parts.role,
    },
    health: {
      available: parts.available(),
      writable:
        parts.role === 'api' && (!replication || replication.copies >= replication.required),
      draining: parts.draining(),
    },
    replication,
    gateways: leases,
    mirrors: mirrors.map((mirror) => ({
      repository: mirror.repository,
      mode: mirror.stages ? 'import' : 'mirror',
      upstream: mirror.upstream,
      sourceRepository: mirror.sourceRepository,
      phase: mirror.state?.phase ?? 'pending',
      errorCode: mirror.state?.errorCode ?? null,
      checkedAt: mirror.state?.checkedAt ?? null,
      syncedAt: mirror.state?.syncedAt ?? null,
      lagChanges: mirror.state ? lag(mirror.state.head, mirror.state.cursor) : null,
      copiedArtifacts: mirror.state?.copiedArtifacts ?? 0,
      copiedBytes: mirror.state?.copiedBytes ?? '0',
    })),
    updates: updates && {
      currentVersion: updates.currentVersion,
      latest: updates.latest?.version ?? null,
      phase: updates.phase,
      error: updates.error,
      automatic: updates.automatic,
      heartbeatAt: updates.heartbeatAt,
    },
    downloads: {
      strategy: queue.settings.strategy,
      sessions: queue.settings.sessions,
      active: queue.active,
      waiting: Object.values(queue.waiting).reduce((sum, count) => sum + count, 0),
      oldestWaitSeconds: queue.oldestWaitSeconds,
      bytesPerSecond: queue.bytesPerSecond,
    },
  };
}

/** `GET /api/v1/system/topology` (ADR 0077): this installation as one site of a fleet. */
export function registerTopologyRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  parts: TopologyParts,
) {
  app.get(
    '/api/v1/system/topology',
    { schema: { response: { 200: topologySchema } } },
    async (request) => {
      requireAdministrator(principal(request));
      retentionObject(request.query, []);
      return collectTopology(parts);
    },
  );
}

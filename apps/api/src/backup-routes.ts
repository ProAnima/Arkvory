import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireBackupPermission } from '@proanima/arkvory-domain';
import type { BackupPermission, Principal } from '@proanima/arkvory-domain';
import { backupPageQuery } from '@proanima/arkvory-application';
import type {
  BackupControl,
  BackupJobRecord,
  BackupPointRecord,
  BackupStatusView,
  StoredBackupPlan,
} from '@proanima/arkvory-application';
import type {
  BackupJobResponse,
  BackupPlanResponse,
  BackupPointResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';
import { fields } from './body-fields.js';

const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
const isoOrNull = (milliseconds: number | null) =>
  milliseconds === null ? null : iso(milliseconds);

export function wirePlan(plan: StoredBackupPlan): BackupPlanResponse {
  return {
    enabled: plan.enabled,
    hour: plan.hour,
    minute: plan.minute,
    timezone: plan.timezone,
    retention: { ...plan.retention },
    revision: plan.revision,
  };
}

export function wirePoint(point: BackupPointRecord): BackupPointResponse {
  return {
    id: point.id,
    snapshotAt: iso(point.snapshotAt),
    completedAt: iso(point.completedAt),
    blobs: point.blobs,
    contentBytes: point.contentBytes,
    newBytes: point.newBytes,
    tables: point.tables,
    rows: point.rows,
    pinned: point.pinned,
    verifiedAt: isoOrNull(point.verifiedAt),
    verifyDepth: point.verifyDepth,
    verifyError: point.verifyError,
  };
}

export function wireJob(job: BackupJobRecord): BackupJobResponse {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    phase: job.phase,
    startedAt: iso(job.startedAt),
    finishedAt: isoOrNull(job.finishedAt),
    errorCode: job.errorCode,
    pointId: job.pointId,
    progress: { ...job.progress },
  };
}

export function wireStatus(view: BackupStatusView): BackupStatusResponse {
  return {
    vault: { ...view.vault },
    agent: { ...view.agent, lastSeenAt: isoOrNull(view.agent.lastSeenAt) },
    plan: wirePlan(view.plan),
    lastCompleted: view.lastCompleted ? wirePoint(view.lastCompleted) : null,
    nextRunAt: isoOrNull(view.nextRunAt),
    running: view.running ? wireJob(view.running) : null,
    warnings: view.warnings.map((warning) => ({ ...warning })),
  };
}

/**
 * /api/v1/backup (ADR 0056): translation only. BackupControl authorizes, validates and queues;
 * the agent executes. The permission is checked here first as well, so a caller without it
 * gets 403 before any input validation. Nothing accepts or returns a filesystem path.
 */
export function registerBackupRoutes(
  app: FastifyInstance,
  control: BackupControl,
  principal: (request: FastifyRequest) => Principal,
) {
  type Point = { Params: { id: string } };
  const root = '/api/v1/backup';
  const actor = (request: FastifyRequest, permission: BackupPermission, query: string[] = []) => {
    const caller = principal(request);
    requireBackupPermission(caller, permission);
    return { caller, query: fields(request.query, query, { in: 'query' }) };
  };
  const key = (request: FastifyRequest) => request.headers['idempotency-key'];
  app.get(`${root}/status`, async (r) =>
    wireStatus(await control.status(actor(r, 'backup.read').caller)),
  );
  app.get(`${root}/plan`, async (r) =>
    wirePlan(await control.plan(actor(r, 'backup.read').caller)),
  );
  app.put(`${root}/plan`, async (r) =>
    wirePlan(await control.updatePlan(actor(r, 'backup.manage').caller, r.body)),
  );
  app.post(`${root}/runs`, async (r, reply) =>
    reply.code(202).send(await control.run(actor(r, 'backup.manage').caller, key(r))),
  );
  app.get(`${root}/jobs`, async (r) => {
    const { caller, query } = actor(r, 'backup.read', ['after', 'limit']);
    const result = await control.jobs(caller, backupPageQuery(query));
    return { items: result.items.map(wireJob), next: result.next };
  });
  app.get(`${root}/points`, async (r) => {
    const { caller, query } = actor(r, 'backup.read', ['after', 'limit']);
    const result = await control.points(caller, backupPageQuery(query));
    return { items: result.items.map(wirePoint), next: result.next };
  });
  app.post<Point>(`${root}/points/:id/verify`, async (r, reply) =>
    reply
      .code(202)
      .send(await control.verify(actor(r, 'backup.manage').caller, r.params.id, key(r))),
  );
  app.put<Point>(`${root}/points/:id/pin`, async (r) =>
    wirePoint(await control.pin(actor(r, 'backup.manage').caller, r.params.id, r.body)),
  );
  app.get(`${root}/retention/preview`, async (r) =>
    control.retentionPreview(actor(r, 'backup.read').caller),
  );
  app.post(`${root}/retention/apply`, async (r, reply) =>
    reply.code(202).send(await control.applyRetention(actor(r, 'backup.manage').caller, key(r))),
  );
}

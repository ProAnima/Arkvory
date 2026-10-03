import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { feedbackLimits, readFeedbackRequest } from '@proanima/arkvory-contracts';
import { platform, release } from 'node:os';
import { SCHEMA_VERSION } from '@proanima/arkvory-infrastructure';
import type { MirrorStatus } from '@proanima/arkvory-application';
import { FeedbackForwarder } from './feedback.js';
import type { FeedbackHub } from './feedback.js';
import type { UpdateControl } from './update-control.js';

/** Base64 of the hub's total plus the JSON around it. */
const bodyLimit = Math.ceil((feedbackLimits.totalBytes * 4) / 3) + 1024 * 1024;

/**
 * /api/v1/feedback (ADR 0060): any signed-in principal may write to ProAnimaStudio; the server
 * log and system summary describe the whole installation, so only an administrator attaches or
 * previews them.
 */
export function registerFeedbackRoutes(
  app: FastifyInstance,
  principal: (r: FastifyRequest) => Principal,
  forwarder: FeedbackForwarder,
) {
  const administrator = (r: FastifyRequest) => {
    const actor = principal(r);
    if (actor.managed || actor.administrator !== true)
      throw new ArkvoryError('forbidden', 'Administrator required', {
        reason: 'administrator_required',
      });
  };
  app.post('/api/v1/feedback', { bodyLimit }, async (r, reply) => {
    principal(r);
    let request;
    try {
      request = readFeedbackRequest(r.body);
    } catch {
      throw new ArkvoryError('invalid_input', 'Invalid feedback');
    }
    if (request.serverLog) administrator(r);
    return reply.code(202).send(await forwarder.send(request));
  });
  app.get('/api/v1/feedback/attachments', async (r) => {
    administrator(r);
    retentionObject(r.query, []);
    return forwarder.attachments();
  });
}

export interface FeedbackComposition {
  readonly hub: FeedbackHub | null;
  readonly version: string;
  readonly log: { text(): string } | null;
  readonly mirrors: Pick<MirrorStatus, 'all'>;
  readonly updates: UpdateControl;
}

/** Facts for the studio's support, without addresses, names or secrets. */
async function systemSummary(parts: FeedbackComposition): Promise<Record<string, unknown>> {
  const snapshot = (await parts.updates.status().catch(() => ({ snapshot: null }))).snapshot;
  const mirrors = await parts.mirrors.all().catch(() => []);
  return {
    collectedAt: new Date().toISOString(),
    arkvory: parts.version,
    schema: SCHEMA_VERSION,
    node: process.version,
    os: `${platform()} ${release()}`,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssBytes: process.memoryUsage().rss,
    updates: snapshot && {
      currentVersion: snapshot.currentVersion,
      latest: snapshot.latest?.version ?? null,
      phase: snapshot.phase,
      error: snapshot.error,
      automatic: snapshot.automatic,
      pinned: snapshot.pin !== null,
      ...(snapshot.channel ? { channel: snapshot.channel } : {}),
    },
    mirrors: mirrors.map((mirror) => ({
      repository: mirror.repository,
      mode: mirror.stages ? 'import' : 'mirror',
      phase: mirror.state?.phase ?? 'pending',
      errorCode: mirror.state?.errorCode ?? null,
      syncedAt: mirror.state?.syncedAt ?? null,
    })),
  };
}

export function registerFeedback(
  app: FastifyInstance,
  principal: (r: FastifyRequest) => Principal,
  parts: FeedbackComposition,
) {
  registerFeedbackRoutes(
    app,
    principal,
    new FeedbackForwarder({
      hub: parts.hub,
      version: parts.version,
      log: parts.log,
      system: () => systemSummary(parts),
    }),
  );
}

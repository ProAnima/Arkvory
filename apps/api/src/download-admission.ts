import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ArkvoryError,
  requestedDownloadClass,
  type DownloadClass,
  type Principal,
} from '@proanima/arkvory-domain';
import type { AdmissionQueue, DownloadScheduler } from '@proanima/arkvory-infrastructure';

/** One admitted response: bytes it sent and how it ended. `end` is idempotent. */
export interface ContentAdmission {
  progress(bytes: number): void;
  end(reachedEnd: boolean): void;
}

/**
 * Objects up to this size are admitted per request: a couple of ranges, done in moments, they
 * must not queue behind whole multi-gigabyte downloads (ADR 0076).
 */
export const SESSION_THRESHOLD_BYTES = 16 * 1024 * 1024;

/** People queue as interactive, services and links as release (ADR 0076). */
function ownClass(principal: Principal): DownloadClass {
  return principal.credential === 'session' || principal.credential === 'personal-token'
    ? 'interactive'
    : 'release';
}

interface AdmissionServices {
  readonly downloadGate: Pick<AdmissionQueue, 'acquire'>;
  readonly downloadScheduler: Pick<DownloadScheduler, 'admit' | 'policy'>;
  readonly now?: () => number;
  /** Tests lower it; production uses SESSION_THRESHOLD_BYTES. */
  readonly sessionThresholdBytes?: number;
}

/**
 * Admits one content response. Large objects belong to a download session keyed by principal,
 * object and client address, so the ranges of one download pass once it has its place; a
 * waiting session is answered 503 busy (download_queued) with its place, expected start and when
 * to come back. Small objects and the `shared` strategy keep admission per request.
 */
export function createDownloadAdmission(services: AdmissionServices) {
  const now = services.now ?? Date.now;
  const threshold = services.sessionThresholdBytes ?? SESSION_THRESHOLD_BYTES;
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    principal: Principal,
    objectId: string,
    size: number,
    signal: AbortSignal,
  ): Promise<ContentAdmission> => {
    if (size <= threshold || services.downloadScheduler.policy.strategy === 'shared') {
      const release = await services.downloadGate.acquire(principal.id, signal);
      return { progress: () => undefined, end: release };
    }
    const admission = services.downloadScheduler.admit({
      key: `${principal.id}\n${objectId}\n${request.ip}`,
      principal: principal.id,
      class: requestedDownloadClass(ownClass(principal), request.headers['arkvory-priority']),
      size,
    });
    if (admission.state === 'active') return admission.lease;
    reply.removeHeader('ETag');
    reply.header('Arkvory-Queue-Position', String(admission.position));
    if (admission.startsAt !== undefined)
      reply.header('Arkvory-Starts-At', new Date(admission.startsAt).toISOString());
    throw new ArkvoryError('busy', 'Download is queued', {
      reason: 'download_queued',
      retryAfterSeconds: Math.max(1, Math.ceil((admission.checkAt - now()) / 1000)),
    });
  };
}
export type DownloadAdmission = ReturnType<typeof createDownloadAdmission>;

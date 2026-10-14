import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ArkvoryError,
  requestedDownloadClass,
  type DownloadClass,
  type DownloadResponseEnd,
  type Principal,
} from '@proanima/arkvory-domain';
import type { AdmissionQueue, DownloadScheduler } from '@proanima/arkvory-infrastructure';

/** One admitted response: bytes it sent and how it ended. `end` is idempotent. */
export interface ContentAdmission {
  progress(bytes: number): void;
  end(how: DownloadResponseEnd): void;
}

/** A client's own id for one download: the session key instead of its address (ADR 0076). */
const downloadId = /^[A-Za-z0-9_-]{16,64}$/;

/** People queue as interactive, services and links as release (ADR 0076). */
function ownClass(principal: Principal): DownloadClass {
  return principal.credential === 'session' || principal.credential === 'personal-token'
    ? 'interactive'
    : 'release';
}

/**
 * Who a download counts for. A link is its own principal, not its issuer: everyone with links
 * of one person would otherwise share that person's turn and session limit.
 */
function queuePrincipal(request: FastifyRequest, principal: Principal) {
  const query: unknown = request.query;
  const token =
    typeof query === 'object' && query !== null && 'token' in query ? query.token : undefined;
  return principal.credential === 'transfer-token' && typeof token === 'string'
    ? `link:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
    : principal.id;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) throw new ArkvoryError('invalid_input', `Repeated ${name} header`);
  return value;
}

interface AdmissionServices {
  readonly downloadGate: Pick<AdmissionQueue, 'acquire'>;
  readonly downloadScheduler: Pick<
    DownloadScheduler,
    'admit' | 'admitHeld' | 'policy' | 'wallClock'
  >;
}

/**
 * Admits one content response. Objects above `sessionMinBytes` belong to a download session
 * keyed by principal, object and the client's `Arkvory-Download-Id` (else its address), so the
 * ranges of one download pass once it has its place. A waiting client of the queue protocol is
 * answered at once with 503 busy (download_queued), its place, expected start and when to come
 * back; another client is held until its turn for a bounded time first. Small objects and the
 * `shared` strategy keep admission per request.
 */
export function createDownloadAdmission(services: AdmissionServices) {
  const scheduler = services.downloadScheduler;
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
    principal: Principal,
    objectId: string,
    size: number,
    signal: AbortSignal,
  ): Promise<ContentAdmission> => {
    const id = header(request, 'arkvory-download-id');
    if (id !== undefined && !downloadId.test(id))
      throw new ArkvoryError(
        'invalid_input',
        'Arkvory-Download-Id must be 16 to 64 characters of A-Z, a-z, 0-9, _ and -',
      );
    const downloadClass = requestedDownloadClass(
      ownClass(principal),
      header(request, 'arkvory-download-class'),
    );
    const policy = scheduler.policy;
    if (size <= policy.sessionMinBytes || policy.strategy === 'shared') {
      const release = await services.downloadGate.acquire(principal.id, signal);
      return { progress: () => undefined, end: release };
    }
    const who = queuePrincipal(request, principal);
    const session = {
      key: `${who}\n${objectId}\n${id ?? `ip:${request.ip}`}`,
      principal: who,
      class: downloadClass,
      size,
      queueAware: id !== undefined,
    };
    reply.header('Arkvory-Download-Class', downloadClass);
    const admission = session.queueAware
      ? scheduler.admit(session)
      : await scheduler.admitHeld(session, signal);
    if (admission.state === 'active') return admission.lease;
    reply.removeHeader('ETag');
    if (admission.position !== undefined)
      reply.header('Arkvory-Queue-Position', String(admission.position));
    if (admission.startsAt !== undefined)
      reply.header(
        'Arkvory-Starts-At',
        new Date(scheduler.wallClock(admission.startsAt)).toISOString(),
      );
    throw new ArkvoryError('busy', 'Download is queued', {
      reason: 'download_queued',
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((scheduler.wallClock(admission.checkAt) - Date.now()) / 1000),
      ),
    });
  };
}
export type DownloadAdmission = ReturnType<typeof createDownloadAdmission>;

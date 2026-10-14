import {
  downloadSchedulePolicy,
  downloadStrategies,
  parseDownloadWeights,
  type DownloadSchedulePolicy,
} from '@proanima/arkvory-domain';

export interface DownloadQueueSettings {
  readonly downloadQueue: DownloadSchedulePolicy;
  /** How long a request of a client outside the queue protocol is held for its turn. */
  readonly downloadHoldSeconds: number;
}

function whole(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || value < min || value > max)
    throw new Error(`Invalid ${name}: a whole number from ${String(min)} to ${String(max)}`);
  return value;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`Invalid ${name}: true or false`);
  return raw === 'true';
}

/**
 * The download queue of ADR 0076 from the environment. Every value has a safe default; a wrong
 * one stops the start with the variable's name. Read gateways queue per process, so until the
 * shared queue of stage 4 they default to `shared`, admission per request.
 */
export function readDownloadQueue(
  env: NodeJS.ProcessEnv,
  limits: {
    readonly maxDownloads: number;
    readonly perPrincipal: number;
    readonly holdSeconds: number;
    readonly gateways: boolean;
  },
): DownloadQueueSettings {
  const strategy = env['ARKVORY_DOWNLOAD_STRATEGY'] ?? (limits.gateways ? 'shared' : 'ordered');
  const known = downloadStrategies.find((name) => name === strategy);
  if (!known)
    throw new Error('Invalid ARKVORY_DOWNLOAD_STRATEGY: ordered, smallest-first or shared');
  const sessions = whole(env, 'ARKVORY_MAX_DOWNLOAD_SESSIONS', limits.maxDownloads, 1, 1024);
  const queueLimit = whole(env, 'ARKVORY_DOWNLOAD_QUEUE_LIMIT', 65536, 1, 1_048_576);
  const weights = env['ARKVORY_DOWNLOAD_WEIGHTS'];
  let weighted: DownloadSchedulePolicy['weights'] | undefined;
  try {
    weighted = weights === undefined ? undefined : parseDownloadWeights(weights);
  } catch {
    throw new Error(
      'Invalid ARKVORY_DOWNLOAD_WEIGHTS: class=weight pairs, e.g. interactive=8,release=4,bulk=2,background=1',
    );
  }
  const overrides: Partial<DownloadSchedulePolicy> = {
    strategy: known,
    perPrincipalActive: Math.min(limits.perPrincipal, sessions),
    interactiveReserve: whole(
      env,
      'ARKVORY_DOWNLOAD_RESERVE',
      sessions >= 4 ? 1 : 0,
      0,
      sessions - 1,
    ),
    ...(weighted ? { weights: weighted } : {}),
    sessionMinBytes: whole(
      env,
      'ARKVORY_DOWNLOAD_SESSION_MIN_BYTES',
      16 * 1024 * 1024,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    idleMs: whole(env, 'ARKVORY_DOWNLOAD_IDLE_SECONDS', 30, 1, 3600) * 1000,
    agingMs: whole(env, 'ARKVORY_DOWNLOAD_AGING_MINUTES', 15, 0, 10080) * 60000,
    preempt: flag(env, 'ARKVORY_DOWNLOAD_PREEMPT', true),
    rangesPerSession: whole(env, 'ARKVORY_DOWNLOAD_RANGES_PER_SESSION', 4, 1, 64),
    maxSessions: queueLimit,
    maxSessionsPerPrincipal: whole(
      env,
      'ARKVORY_DOWNLOAD_QUEUE_PER_PRINCIPAL',
      Math.min(4096, queueLimit),
      1,
      queueLimit,
    ),
  };
  return {
    downloadQueue: downloadSchedulePolicy(sessions, overrides),
    downloadHoldSeconds: whole(env, 'ARKVORY_DOWNLOAD_HOLD_SECONDS', limits.holdSeconds, 0, 120),
  };
}

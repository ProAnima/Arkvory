import { storageReserveBytes } from '@proanima/arkvory-infrastructure';

export interface OperabilityOptions {
  /** Query pool ceiling; ownership, download lease and pin sessions hold up to three. */
  readonly databasePoolSize?: number;
  /** Concurrent authenticated requests per process, including queued transfers. */
  readonly maxRequests?: number;
  readonly storageReserveBytes?: number;
  readonly accessLog?: boolean;
  /** Time admitted requests may finish after SIGTERM/SIGINT before connections are closed. */
  readonly drainTimeoutMs?: number;
}

export const defaultMaxRequests = 128;
export const defaultDrainTimeoutMs = 30000;
export const maxDrainTimeoutMs = 3600000;

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`Invalid ${name}`);
  return raw === 'true';
}

/**
 * Every admitted or queued transfer holds one request slot, so the budget must leave room for
 * metadata and completion calls. Without an explicit value an installation whose transfer
 * limits already exceed the default keeps starting with a derived budget.
 */
export function readOperability(
  env: NodeJS.ProcessEnv,
  transfers: { readonly maxUploads: number; readonly maxDownloads: number },
): Required<OperabilityOptions> {
  const transferSlots = transfers.maxUploads + transfers.maxDownloads;
  const fallback = Math.max(defaultMaxRequests, transferSlots + 64);
  const maxRequests = integer(env, 'ARKVORY_MAX_REQUESTS', fallback, 1, 4096);
  if (maxRequests <= transferSlots)
    throw new Error('ARKVORY_MAX_REQUESTS must exceed ARKVORY_MAX_UPLOADS + ARKVORY_MAX_DOWNLOADS');
  return {
    databasePoolSize: integer(env, 'ARKVORY_DATABASE_POOL_SIZE', 10, 4, 200),
    maxRequests,
    storageReserveBytes: storageReserveBytes(env['ARKVORY_STORAGE_RESERVE_BYTES']),
    accessLog: flag(env, 'ARKVORY_ACCESS_LOG', true),
    drainTimeoutMs: integer(
      env,
      'ARKVORY_DRAIN_TIMEOUT_MS',
      defaultDrainTimeoutMs,
      0,
      maxDrainTimeoutMs,
    ),
  };
}

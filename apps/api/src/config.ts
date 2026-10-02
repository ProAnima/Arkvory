import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { ArkvoryError, MAX_OBJECT_BYTES } from '@proanima/arkvory-domain';
import { parseKeys, downloadShare, readMirrorSettings } from '@proanima/arkvory-infrastructure';
import type { MirrorConfiguration } from '@proanima/arkvory-application';
import type { SharedDownloadPolicy } from '@proanima/arkvory-infrastructure';
import type { ServiceKey } from '@proanima/arkvory-infrastructure';
import { parseCorsOrigins } from './cors.js';
import { readUploadTimeouts } from './upload-policy.js';
import type { UploadTimeoutOptions } from './upload-policy.js';
import { readOperability } from './operability-config.js';
import type { OperabilityOptions } from './operability-config.js';
import { readTls } from './tls-config.js';
import type { TlsSettings } from './tls-config.js';
export { parseKeys } from '@proanima/arkvory-infrastructure';
export type { ServiceKey } from '@proanima/arkvory-infrastructure';

export interface ServerConfig extends UploadTimeoutOptions, OperabilityOptions {
  readonly role?: 'api' | 'reader';
  readonly sharedDownloads?: SharedDownloadPolicy;
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly host: string;
  readonly port: number;
  readonly capacityBytes: number;
  readonly maxUploads: number;
  readonly maxDownloads: number;
  readonly transferQueueLimit?: number;
  readonly transferQueuePerPrincipal?: number;
  readonly transferQueueTimeoutMs?: number;
  readonly maxUploadsPerPrincipal?: number;
  readonly maxDownloadsPerPrincipal?: number;
  readonly uploadBytesPerSecond?: number;
  readonly downloadBytesPerSecond?: number;
  readonly uploadBytesPerSecondPerPrincipal?: number;
  readonly downloadBytesPerSecondPerPrincipal?: number;
  readonly keys: readonly ServiceKey[];
  readonly corsOrigins?: readonly string[];
  readonly webDirectory?: string;
  readonly updateControlDirectory?: string;
  readonly allowRegistration?: boolean;
  /** Reverse proxies whose X-Forwarded-For is trusted for the client address (IP or CIDR). */
  readonly trustedProxies?: readonly string[];
  /** Operator ceiling for one object; the multipart layout limit applies when unset. */
  readonly maxObjectBytes?: number;
  /** Built-in HTTPS; absent means plain HTTP for loopback or a TLS-terminating proxy. */
  readonly tls?: TlsSettings;
  /** Mirrored repositories (ADR 0058): read-only for clients, synchronized by the worker. */
  readonly mirrors?: readonly MirrorConfiguration[];
}

/** Startup logs may print these messages: they name the variable, never its value or path. */
async function readKeys(path: string): Promise<readonly ServiceKey[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'unknown';
    // The cause keeps the path for debugging; startupReason never walks the cause chain.
    throw new Error(`Cannot read ARKVORY_KEYS_FILE (${code.replace(/[^A-Z0-9_]/g, '')})`, {
      cause: error,
    });
  }
  if (text.length > 1024 * 1024) throw new Error('Key file is too large');
  let keys: unknown;
  try {
    keys = JSON.parse(text);
  } catch {
    throw new Error('ARKVORY_KEYS_FILE is not valid JSON');
  }
  return parseKeys(keys);
}

/** Bytes per second: 0 is unlimited, otherwise 64 KiB/s to 1 TiB/s. */
function byteRate(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name] ?? '0';
  const value = Number(raw);
  if (
    !/^(0|[1-9][0-9]*)$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    (value !== 0 && (value < 65536 || value > 1024 ** 4))
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

/** The API needs which repositories are mirrors and of what; the source key stays with the worker. */
async function readMirrors(env: NodeJS.ProcessEnv): Promise<readonly MirrorConfiguration[]> {
  return (await readMirrorSettings(env['ARKVORY_MIRRORS_FILE'])).map(
    ({ repository, upstream, sourceRepository }) => ({ repository, upstream, sourceRepository }),
  );
}

export async function loadConfig(env: NodeJS.ProcessEnv): Promise<ServerConfig> {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const number = (name: string, fallback: number, maximum: number): number => {
    const raw = env[name];
    const result = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
      throw new Error(`Invalid ${name}`);
    return result;
  };
  const databaseUrl = required('ARKVORY_DATABASE_URL');
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl))
    throw new ArkvoryError(
      'invalid_input',
      'ARKVORY_DATABASE_URL must be a PostgreSQL connection URL',
    );
  const keys = await readKeys(required('ARKVORY_KEYS_FILE'));
  const mirrors = await readMirrors(env);
  const maxUploads = number('ARKVORY_MAX_UPLOADS', 2, 32);
  const maxDownloads = number('ARKVORY_MAX_DOWNLOADS', 16, 256);
  const transferQueueLimit = number('ARKVORY_TRANSFER_QUEUE_LIMIT', 64, 1024);
  const rate = (name: string) => byteRate(env, name);
  const role = env['ARKVORY_ROLE'] ?? 'api';
  if (role !== 'api' && role !== 'reader') throw new Error('Invalid ARKVORY_ROLE');
  let sharedDownloads: SharedDownloadPolicy | undefined;
  const clusterFields = [
    'ARKVORY_GATEWAY_SLOTS',
    'ARKVORY_GATEWAY_SLOT',
    'ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND',
    'ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL',
  ];
  if (clusterFields.some((name) => env[name] !== undefined)) {
    const slot = required('ARKVORY_GATEWAY_SLOT');
    if (!/^(0|[1-9][0-9]?)$/.test(slot)) throw new Error('Invalid ARKVORY_GATEWAY_SLOT');
    sharedDownloads = {
      slot: Number(slot),
      slots: number('ARKVORY_GATEWAY_SLOTS', 0, 16),
      bytesPerSecond: rate('ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND'),
      perPrincipalBytesPerSecond: rate('ARKVORY_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
    };
    downloadShare(sharedDownloads);
    if ((role === 'api') !== (sharedDownloads.slot === 0))
      throw new Error('Writer must use slot zero; readers use other slots');
  }
  if (role === 'reader' && !sharedDownloads)
    throw new Error('Read gateway requires shared download configuration');
  return {
    ...readUploadTimeouts(env),
    ...readOperability(env, { maxUploads, maxDownloads }),
    role,
    ...(sharedDownloads ? { sharedDownloads } : {}),
    databaseUrl,
    ...readIdentityExposure(env),
    ...(env['ARKVORY_MAX_OBJECT_BYTES'] === undefined
      ? {}
      : { maxObjectBytes: number('ARKVORY_MAX_OBJECT_BYTES', MAX_OBJECT_BYTES, MAX_OBJECT_BYTES) }),
    dataDirectory: required('ARKVORY_DATA_DIR'),
    keys,
    ...(mirrors.length > 0 ? { mirrors } : {}),
    corsOrigins: parseCorsOrigins(env['ARKVORY_CORS_ORIGINS']),
    webDirectory: env['ARKVORY_WEB_DIR'] ?? 'apps/web/public',
    ...(env['ARKVORY_UPDATE_CONTROL_DIR']
      ? { updateControlDirectory: env['ARKVORY_UPDATE_CONTROL_DIR'] }
      : {}),
    host: env['ARKVORY_HOST'] ?? '127.0.0.1',
    port: number('ARKVORY_PORT', 8080, 65535),
    ...readTls(env),
    capacityBytes: number('ARKVORY_CAPACITY_BYTES', 10 * 1024 ** 4, Number.MAX_SAFE_INTEGER),
    maxUploads,
    maxDownloads,
    transferQueueLimit,
    transferQueuePerPrincipal: number(
      'ARKVORY_TRANSFER_QUEUE_PER_PRINCIPAL',
      Math.min(8, transferQueueLimit),
      transferQueueLimit,
    ),
    transferQueueTimeoutMs: number('ARKVORY_TRANSFER_QUEUE_TIMEOUT_MS', 20000, 120000),
    maxUploadsPerPrincipal: number('ARKVORY_MAX_UPLOADS_PER_PRINCIPAL', 1, maxUploads),
    maxDownloadsPerPrincipal: number(
      'ARKVORY_MAX_DOWNLOADS_PER_PRINCIPAL',
      Math.min(4, maxDownloads),
      maxDownloads,
    ),
    uploadBytesPerSecond: rate('ARKVORY_UPLOAD_BYTES_PER_SECOND'),
    downloadBytesPerSecond: rate('ARKVORY_DOWNLOAD_BYTES_PER_SECOND'),
    uploadBytesPerSecondPerPrincipal: rate('ARKVORY_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
    downloadBytesPerSecondPerPrincipal: rate('ARKVORY_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
  };
}

function readIdentityExposure(env: NodeJS.ProcessEnv) {
  return {
    allowRegistration: env['ARKVORY_ALLOW_REGISTRATION'] === 'true',
    trustedProxies: parseTrustedProxies(env['ARKVORY_TRUSTED_PROXIES']),
  };
}
/** Exact proxy addresses or CIDR ranges; hostnames and wildcards are refused. */
export function parseTrustedProxies(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length > 32) throw new Error('ARKVORY_TRUSTED_PROXIES lists at most 32 entries');
  for (const entry of entries) {
    const [address = '', prefix, extra] = entry.split('/');
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    if (
      family === 0 ||
      extra !== undefined ||
      (prefix !== undefined && (!/^[0-9]{1,3}$/.test(prefix) || Number(prefix) > bits))
    )
      throw new Error('Invalid ARKVORY_TRUSTED_PROXIES entry');
  }
  return entries;
}

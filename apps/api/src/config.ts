import { readFile } from 'node:fs/promises';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { parseKeys, downloadShare } from '@proanima/arkvory-infrastructure';
import type { SharedDownloadPolicy } from '@proanima/arkvory-infrastructure';
import type { ServiceKey } from '@proanima/arkvory-infrastructure';
import { parseCorsOrigins } from './cors.js';
import { readUploadTimeouts } from './upload-policy.js';
import type { UploadTimeoutOptions } from './upload-policy.js';
export { parseKeys } from '@proanima/arkvory-infrastructure';
export type { ServiceKey } from '@proanima/arkvory-infrastructure';

export interface ServerConfig extends UploadTimeoutOptions {
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
  const keyFile = await readFile(required('ARKVORY_KEYS_FILE'), 'utf8');
  if (keyFile.length > 1024 * 1024) throw new Error('Key file is too large');
  const keys: unknown = JSON.parse(keyFile);
  const maxUploads = number('ARKVORY_MAX_UPLOADS', 2, 32);
  const maxDownloads = number('ARKVORY_MAX_DOWNLOADS', 16, 256);
  const transferQueueLimit = number('ARKVORY_TRANSFER_QUEUE_LIMIT', 64, 1024);
  const rate = (name: string): number => {
    const raw = env[name] ?? '0';
    const value = Number(raw);
    if (
      !/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      (value !== 0 && (value < 65536 || value > 1024 ** 4))
    )
      throw new Error(`Invalid ${name}`);
    return value;
  };
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
    role,
    ...(sharedDownloads ? { sharedDownloads } : {}),
    databaseUrl,
    dataDirectory: required('ARKVORY_DATA_DIR'),
    keys: parseKeys(keys),
    corsOrigins: parseCorsOrigins(env['ARKVORY_CORS_ORIGINS']),
    webDirectory: env['ARKVORY_WEB_DIR'] ?? 'apps/web/public',
    ...(env['ARKVORY_UPDATE_CONTROL_DIR']
      ? { updateControlDirectory: env['ARKVORY_UPDATE_CONTROL_DIR'] }
      : {}),
    host: env['ARKVORY_HOST'] ?? '127.0.0.1',
    port: number('ARKVORY_PORT', 8080, 65535),
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

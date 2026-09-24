import { readFile } from 'node:fs/promises';
import { DepotError } from '@proanima/depot-domain';
import { parseKeys, downloadShare } from '@proanima/depot-infrastructure';
import type { SharedDownloadPolicy } from '@proanima/depot-infrastructure';
import type { ServiceKey } from '@proanima/depot-infrastructure';
import { parseCorsOrigins } from './cors.js';
export { parseKeys } from '@proanima/depot-infrastructure';
export type { ServiceKey } from '@proanima/depot-infrastructure';

export interface ServerConfig {
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
  const databaseUrl = required('DEPOT_DATABASE_URL');
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl))
    throw new DepotError('invalid_input', 'DEPOT_DATABASE_URL must be a PostgreSQL connection URL');
  const keyFile = await readFile(required('DEPOT_KEYS_FILE'), 'utf8');
  if (keyFile.length > 1024 * 1024) throw new Error('Key file is too large');
  const keys: unknown = JSON.parse(keyFile);
  const maxUploads = number('DEPOT_MAX_UPLOADS', 2, 32);
  const maxDownloads = number('DEPOT_MAX_DOWNLOADS', 16, 256);
  const transferQueueLimit = number('DEPOT_TRANSFER_QUEUE_LIMIT', 64, 1024);
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
  const role = env['DEPOT_ROLE'] ?? 'api';
  if (role !== 'api' && role !== 'reader') throw new Error('Invalid DEPOT_ROLE');
  let sharedDownloads: SharedDownloadPolicy | undefined;
  const clusterFields = [
    'DEPOT_GATEWAY_SLOTS',
    'DEPOT_GATEWAY_SLOT',
    'DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND',
    'DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL',
  ];
  if (clusterFields.some((name) => env[name] !== undefined)) {
    const slot = required('DEPOT_GATEWAY_SLOT');
    if (!/^(0|[1-9][0-9]?)$/.test(slot)) throw new Error('Invalid DEPOT_GATEWAY_SLOT');
    sharedDownloads = {
      slot: Number(slot),
      slots: number('DEPOT_GATEWAY_SLOTS', 0, 16),
      bytesPerSecond: rate('DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND'),
      perPrincipalBytesPerSecond: rate('DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
    };
    downloadShare(sharedDownloads);
    if ((role === 'api') !== (sharedDownloads.slot === 0))
      throw new Error('Writer must use slot zero; readers use other slots');
  }
  if (role === 'reader' && !sharedDownloads)
    throw new Error('Read gateway requires shared download configuration');
  return {
    role,
    ...(sharedDownloads ? { sharedDownloads } : {}),
    databaseUrl,
    dataDirectory: required('DEPOT_DATA_DIR'),
    keys: parseKeys(keys),
    corsOrigins: parseCorsOrigins(env['DEPOT_CORS_ORIGINS']),
    host: env['DEPOT_HOST'] ?? '127.0.0.1',
    port: number('DEPOT_PORT', 8080, 65535),
    capacityBytes: number('DEPOT_CAPACITY_BYTES', 10 * 1024 ** 4, Number.MAX_SAFE_INTEGER),
    maxUploads,
    maxDownloads,
    transferQueueLimit,
    transferQueuePerPrincipal: number(
      'DEPOT_TRANSFER_QUEUE_PER_PRINCIPAL',
      Math.min(8, transferQueueLimit),
      transferQueueLimit,
    ),
    transferQueueTimeoutMs: number('DEPOT_TRANSFER_QUEUE_TIMEOUT_MS', 20000, 120000),
    maxUploadsPerPrincipal: number('DEPOT_MAX_UPLOADS_PER_PRINCIPAL', 1, maxUploads),
    maxDownloadsPerPrincipal: number(
      'DEPOT_MAX_DOWNLOADS_PER_PRINCIPAL',
      Math.min(4, maxDownloads),
      maxDownloads,
    ),
    uploadBytesPerSecond: rate('DEPOT_UPLOAD_BYTES_PER_SECOND'),
    downloadBytesPerSecond: rate('DEPOT_DOWNLOAD_BYTES_PER_SECOND'),
    uploadBytesPerSecondPerPrincipal: rate('DEPOT_UPLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
    downloadBytesPerSecondPerPrincipal: rate('DEPOT_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL'),
  };
}

import { readFile } from 'node:fs/promises';
import { DepotError } from '@proanima/depot-domain';
import { parseKeys } from '@proanima/depot-infrastructure';
import type { ServiceKey } from '@proanima/depot-infrastructure';
export { parseKeys } from '@proanima/depot-infrastructure';
export type { ServiceKey } from '@proanima/depot-infrastructure';

export interface ServerConfig {
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly host: string;
  readonly port: number;
  readonly capacityBytes: number;
  readonly maxUploads: number;
  readonly maxDownloads: number;
  readonly keys: readonly ServiceKey[];
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
  return {
    databaseUrl,
    dataDirectory: required('DEPOT_DATA_DIR'),
    keys: parseKeys(keys),
    host: env['DEPOT_HOST'] ?? '127.0.0.1',
    port: number('DEPOT_PORT', 8080, 65535),
    capacityBytes: number('DEPOT_CAPACITY_BYTES', 10 * 1024 ** 4, Number.MAX_SAFE_INTEGER),
    maxUploads: number('DEPOT_MAX_UPLOADS', 2, 32),
    maxDownloads: number('DEPOT_MAX_DOWNLOADS', 16, 256),
  };
}

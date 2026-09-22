import { readFile } from 'node:fs/promises';
import { DepotError, requireRepository } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';

export interface ServiceKey {
  readonly sha256: string;
  readonly principal: Principal;
}
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

export function parseKeys(value: unknown): readonly ServiceKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw new Error('Key file must contain between 1 and 1000 service keys');
  const keys: ServiceKey[] = [];
  const entries: readonly unknown[] = value;
  for (const item of entries) {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid service key entry');
    const entry: Record<string, unknown> = Object.fromEntries(Object.entries(item));
    const { id, sha256, repositories, permissions } = entry;
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(id) ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Array.isArray(repositories) ||
      !Array.isArray(permissions)
    )
      throw new Error('Invalid service key entry');
    const repos: string[] = [];
    for (const repository of repositories) {
      if (typeof repository !== 'string') throw new Error('Invalid repository scope');
      repos.push(requireRepository(repository));
    }
    const grants: ('read' | 'write')[] = [];
    const rawPermissions: readonly unknown[] = permissions;
    for (const permission of rawPermissions) {
      if (permission !== 'read' && permission !== 'write') throw new Error('Invalid permission');
      grants.push(permission);
    }
    if (keys.some((key) => key.sha256 === sha256)) throw new Error('Duplicate service key hash');
    keys.push({ sha256, principal: { id, repositories: repos, permissions: grants } });
  }
  return keys;
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

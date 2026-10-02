import { BackupFailure } from '@proanima/arkvory-domain';
import { storageReserveBytes } from '@proanima/arkvory-infrastructure';

/** Source of a capture: the same variables as API and worker, plus bounded backup timings. */
export interface SourceConfig {
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly reserveBytes: number;
  readonly leaseSeconds: number;
  readonly snapshotSeconds: number;
  readonly barrierSeconds: number;
}

function bounded(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^[1-9][0-9]{0,6}$/.test(raw) || value < min || value > max)
    throw new BackupFailure('invalid_argument', `Invalid ${name}`);
  return value;
}

export function databaseUrl(value: string | undefined, name: string): string {
  if (!value) throw new BackupFailure('invalid_argument', `Missing ${name}`);
  if (!/^postgres(?:ql)?:\/\//.test(value))
    throw new BackupFailure('invalid_argument', `${name} must be a PostgreSQL connection URL`);
  return value;
}

/** Messages name the variable, never its value: URLs carry credentials. */
export function sourceConfig(env: NodeJS.ProcessEnv): SourceConfig {
  const dataDirectory = env['ARKVORY_DATA_DIR'];
  if (!dataDirectory) throw new BackupFailure('invalid_argument', 'Missing ARKVORY_DATA_DIR');
  let reserveBytes: number;
  try {
    reserveBytes = storageReserveBytes(env['ARKVORY_STORAGE_RESERVE_BYTES']);
  } catch {
    throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_STORAGE_RESERVE_BYTES');
  }
  return {
    databaseUrl: databaseUrl(env['ARKVORY_DATABASE_URL'], 'ARKVORY_DATABASE_URL'),
    dataDirectory,
    reserveBytes,
    leaseSeconds: bounded(env, 'ARKVORY_BACKUP_LEASE_SECONDS', 60, 2, 3600),
    snapshotSeconds: bounded(env, 'ARKVORY_BACKUP_SNAPSHOT_SECONDS', 1800, 60, 86400),
    barrierSeconds: bounded(env, 'ARKVORY_BACKUP_BARRIER_SECONDS', 30, 1, 600),
  };
}

export function restoreReserveBytes(env: NodeJS.ProcessEnv): number {
  try {
    return storageReserveBytes(env['ARKVORY_STORAGE_RESERVE_BYTES']);
  } catch {
    throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_STORAGE_RESERVE_BYTES');
  }
}

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

/** The supervised agent: source configuration plus optional vault, bandwidth and polling. */
export interface AgentConfig {
  readonly source: SourceConfig;
  /** Initialized vault directory, or null until an operator configures one. */
  readonly vault: string | null;
  /** File with the agent key for an encrypted vault (ADR 0070); null for a plain one. */
  readonly vaultKeyFile: string | null;
  /** Copy bandwidth cap; null is unlimited. */
  readonly bytesPerSecond: number | null;
  readonly pollSeconds: number;
}

/** 64 KiB/s up to 1 TB/s: below the floor a 4 TB first copy could never finish. */
function bandwidth(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  if (!/^[1-9][0-9]{4,12}$/.test(raw) || Number(raw) < 65536)
    throw new BackupFailure('invalid_argument', 'Invalid ARKVORY_BACKUP_BYTES_PER_SECOND');
  return Number(raw);
}

export function agentConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const vault = env['ARKVORY_BACKUP_VAULT'];
  const keyFile = env['ARKVORY_BACKUP_VAULT_KEY_FILE'];
  return {
    source: sourceConfig(env),
    vault: vault === undefined || vault === '' ? null : vault,
    vaultKeyFile: keyFile === undefined || keyFile === '' ? null : keyFile,
    bytesPerSecond: bandwidth(env['ARKVORY_BACKUP_BYTES_PER_SECOND']),
    pollSeconds: bounded(env, 'ARKVORY_BACKUP_POLL_SECONDS', 15, 1, 3600),
  };
}

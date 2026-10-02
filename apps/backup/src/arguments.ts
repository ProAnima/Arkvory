import { BackupFailure, requireId } from '@proanima/arkvory-domain';
import type { BackupFailureCode } from '@proanima/arkvory-domain';

export type BackupCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'agent' }
  | { readonly kind: 'vault-init'; readonly vault: string }
  | { readonly kind: 'capture'; readonly vault: string; readonly idempotencyKey?: string }
  | { readonly kind: 'list'; readonly vault: string }
  | {
      readonly kind: 'verify';
      readonly vault: string;
      readonly pointId?: string;
      readonly deep: boolean;
    }
  | {
      readonly kind: 'restore';
      readonly vault: string;
      readonly pointId: string;
      readonly databaseUrl?: string;
      readonly storage: string;
      readonly confirmed: boolean;
      readonly report?: string;
    };

export const usage = `Usage: arkvory-backup <command>
  agent                                    supervised service: schedule, requests, retention
  vault init <dir>                         create a vault in a new or empty directory
  capture --vault <dir> [--idempotency-key <key>]
  list --vault <dir>
  verify --vault <dir> [--point <id>] [--deep]
  restore --vault <dir> --point <id> --storage <dir> [--database-url <url>] [--yes] [--report <file>]
Source configuration: ARKVORY_DATABASE_URL, ARKVORY_DATA_DIR (as for API and worker).
Agent: ARKVORY_BACKUP_VAULT (initialized vault), ARKVORY_BACKUP_BYTES_PER_SECOND (copy cap),
ARKVORY_BACKUP_POLL_SECONDS (15). SIGTERM/SIGINT stop it after the current phase (exit 0).
Restore target database: --database-url or ARKVORY_RESTORE_DATABASE_URL (preferred: not in ps).
Without --yes, restore only runs the read-only preflight. Exit codes: 0 ok, 1 failed,
2 usage, 3 refused by a safety check, 4 integrity failure, 5 busy (retry later).`;

/** Closed exit codes, documented in the runbook. */
export function exitCodeFor(code: BackupFailureCode): number {
  switch (code) {
    case 'invalid_argument':
      return 2;
    case 'attempts_exhausted':
    case 'point_not_found':
    case 'schema_mismatch':
    case 'storage_mismatch':
    case 'target_not_empty':
    case 'unknown_table':
    case 'unsafe_path':
    case 'upgrade_required':
    case 'vault_missing':
      return 3;
    case 'blob_missing':
    case 'integrity_mismatch':
    case 'invalid_manifest':
      return 4;
    case 'barrier_timeout':
    case 'busy':
      return 5;
    case 'capture_timeout':
    case 'capture_too_large':
    case 'interrupted':
    case 'lease_lost':
    case 'snapshot_lost':
    case 'storage_full':
    case 'unavailable':
    case 'unexpected':
    case 'vault_full':
      return 1;
  }
}

function invalid(message: string): BackupFailure {
  return new BackupFailure('invalid_argument', message);
}

/** Flags of one command; every flag is known, given once and, except switches, has a value. */
function flags(
  args: readonly string[],
  allowed: Readonly<Record<string, 'value' | 'switch'>>,
): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index] ?? '';
    const kind = allowed[name];
    if (!kind) throw invalid(`Unknown argument: ${name.slice(0, 64)}`);
    if (result.has(name)) throw invalid(`Repeated argument: ${name}`);
    if (kind === 'switch') {
      result.set(name, true);
      continue;
    }
    const value = args[++index];
    if (value === undefined || value === '' || value.startsWith('--'))
      throw invalid(`Missing value for ${name}`);
    result.set(name, value);
  }
  return result;
}
function text(values: Map<string, string | true>, name: string): string | undefined {
  const value = values.get(name);
  return typeof value === 'string' ? value : undefined;
}
function required(values: Map<string, string | true>, name: string): string {
  const value = text(values, name);
  if (value === undefined) throw invalid(`Missing ${name}`);
  return value;
}
function point(value: string): string {
  try {
    return requireId(value);
  } catch {
    throw invalid('Invalid point id');
  }
}

export function parseArguments(argv: readonly string[]): BackupCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === 'help') return { kind: 'help' };
  switch (command) {
    case 'agent':
      if (rest.length) throw invalid('Usage: agent');
      return { kind: 'agent' };
    case 'vault': {
      const [action, directory, ...extra] = rest;
      if (action !== 'init' || !directory || directory.startsWith('--') || extra.length)
        throw invalid('Usage: vault init <dir>');
      return { kind: 'vault-init', vault: directory };
    }
    case 'capture': {
      const values = flags(rest, { '--vault': 'value', '--idempotency-key': 'value' });
      const key = text(values, '--idempotency-key');
      if (key !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key))
        throw invalid('Idempotency key: 1-128 of A-Z a-z 0-9 _ . : -');
      const vault = required(values, '--vault');
      return key === undefined
        ? { kind: 'capture', vault }
        : { kind: 'capture', vault, idempotencyKey: key };
    }
    case 'list':
      return { kind: 'list', vault: required(flags(rest, { '--vault': 'value' }), '--vault') };
    case 'verify': {
      const values = flags(rest, { '--vault': 'value', '--point': 'value', '--deep': 'switch' });
      const pointId = text(values, '--point');
      const vault = required(values, '--vault');
      const deep = values.has('--deep');
      return pointId === undefined
        ? { kind: 'verify', vault, deep }
        : { kind: 'verify', vault, deep, pointId: point(pointId) };
    }
    case 'restore':
      return restore(rest);
    default:
      throw invalid(`Unknown command: ${command.slice(0, 32)}`);
  }
}

function restore(rest: readonly string[]): BackupCommand {
  const values = flags(rest, {
    '--vault': 'value',
    '--point': 'value',
    '--database-url': 'value',
    '--storage': 'value',
    '--yes': 'switch',
    '--report': 'value',
  });
  const databaseUrl = text(values, '--database-url');
  const report = text(values, '--report');
  return {
    kind: 'restore',
    vault: required(values, '--vault'),
    pointId: point(required(values, '--point')),
    storage: required(values, '--storage'),
    confirmed: values.has('--yes'),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(report === undefined ? {} : { report }),
  };
}

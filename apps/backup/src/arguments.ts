import { BackupFailure, requireId } from '@proanima/arkvory-domain';
import type { BackupFailureCode } from '@proanima/arkvory-domain';

export type BackupCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'agent' }
  | {
      readonly kind: 'vault-init';
      readonly vault: string;
      readonly encryption: VaultEncryption;
    }
  | {
      readonly kind: 'vault-key';
      readonly vault: string;
      /** Agent key or the recovery kit; absent: ARKVORY_BACKUP_VAULT_KEY_FILE. */
      readonly keyFile?: string;
      readonly operation: KeyOperation;
    }
  | {
      readonly kind: 'capture';
      readonly vault: string;
      readonly keyFile?: string;
      readonly idempotencyKey?: string;
    }
  | { readonly kind: 'list'; readonly vault: string; readonly keyFile?: string }
  | {
      readonly kind: 'verify';
      readonly vault: string;
      readonly keyFile?: string;
      readonly pointId?: string;
      readonly deep: boolean;
    }
  | {
      readonly kind: 'restore';
      readonly vault: string;
      readonly keyFile?: string;
      readonly pointId: string;
      readonly databaseUrl?: string;
      readonly storage: string;
      readonly confirmed: boolean;
      readonly report?: string;
    };

/** How a new vault is protected (ADR 0070): encrypted by default, plain only on request. */
export type VaultEncryption =
  | { readonly mode: 'none' }
  | { readonly mode: 'encrypted'; readonly kitFile: string; readonly agentKeyFile: string };

/** Administration of the key slots of an encrypted vault. */
export type KeyOperation =
  | { readonly action: 'list' }
  | { readonly action: 'verify' }
  | { readonly action: 'add-recovery'; readonly kitFile: string }
  | { readonly action: 'rotate-agent'; readonly agentKeyFile: string }
  | { readonly action: 'remove'; readonly slotId: string };

export const usage = `Usage: arkvory-backup <command>
  agent                                    supervised service: schedule, requests, retention
  vault init <dir> --kit-file <file> --agent-key-file <file>
                                           create an encrypted vault; writes the recovery kit
                                           (keep it off this server) and the agent key
  vault init <dir> --no-encryption         create a plain vault (the volume must be encrypted)
  vault key list --vault <dir>             key slots of an encrypted vault (no key is shown)
  vault key verify --vault <dir> [--key-file <file>]
  vault key add-recovery --vault <dir> [--key-file <file>] --kit-file <file>
  vault key rotate-agent --vault <dir> [--key-file <file>] --agent-key-file <file>
  vault key remove --vault <dir> [--key-file <file>] --slot <id>
  capture --vault <dir> [--key-file <file>] [--idempotency-key <key>]
  list --vault <dir> [--key-file <file>]
  verify --vault <dir> [--key-file <file>] [--point <id>] [--deep]
  restore --vault <dir> [--key-file <file>] --point <id> --storage <dir> [--database-url <url>] [--yes] [--report <file>]
Source configuration: ARKVORY_DATABASE_URL, ARKVORY_DATA_DIR (as for API and worker).
Agent: ARKVORY_BACKUP_VAULT (initialized vault), ARKVORY_BACKUP_BYTES_PER_SECOND (copy cap),
ARKVORY_BACKUP_POLL_SECONDS (15). SIGTERM/SIGINT stop it after the current phase (exit 0).
Encrypted vault: --key-file (or ARKVORY_BACKUP_VAULT_KEY_FILE) names the agent key file
or a recovery kit; the key is never an argument and never printed.
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
    case 'vault_key_invalid':
    case 'vault_key_missing':
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
    case 'vault':
      return vaultCommand(rest);
    case 'capture': {
      const values = flags(rest, {
        '--vault': 'value',
        '--key-file': 'value',
        '--idempotency-key': 'value',
      });
      const capturedKey = text(values, '--key-file');
      const key = text(values, '--idempotency-key');
      if (key !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key))
        throw invalid('Idempotency key: 1-128 of A-Z a-z 0-9 _ . : -');
      return {
        kind: 'capture',
        vault: required(values, '--vault'),
        ...(capturedKey === undefined ? {} : { keyFile: capturedKey }),
        ...(key === undefined ? {} : { idempotencyKey: key }),
      };
    }
    case 'list': {
      const values = flags(rest, { '--vault': 'value', '--key-file': 'value' });
      const keyFile = text(values, '--key-file');
      return {
        kind: 'list',
        vault: required(values, '--vault'),
        ...(keyFile === undefined ? {} : { keyFile }),
      };
    }
    case 'verify': {
      const values = flags(rest, {
        '--vault': 'value',
        '--key-file': 'value',
        '--point': 'value',
        '--deep': 'switch',
      });
      const pointId = text(values, '--point');
      const keyFile = text(values, '--key-file');
      return {
        kind: 'verify',
        vault: required(values, '--vault'),
        deep: values.has('--deep'),
        ...(keyFile === undefined ? {} : { keyFile }),
        ...(pointId === undefined ? {} : { pointId: point(pointId) }),
      };
    }
    case 'restore':
      return restore(rest);
    default:
      throw invalid(`Unknown command: ${command.slice(0, 32)}`);
  }
}

/** `vault init <dir> …` and `vault key <action> …`. */
function vaultCommand(rest: readonly string[]): BackupCommand {
  const [action, second, ...tail] = rest;
  if (action === 'init') {
    if (!second || second.startsWith('--')) throw invalid('Usage: vault init <dir> …');
    const values = flags(tail, {
      '--no-encryption': 'switch',
      '--kit-file': 'value',
      '--agent-key-file': 'value',
    });
    const kitFile = text(values, '--kit-file');
    const agentKeyFile = text(values, '--agent-key-file');
    if (values.has('--no-encryption')) {
      if (kitFile !== undefined || agentKeyFile !== undefined)
        throw invalid('--no-encryption takes no key files');
      return { kind: 'vault-init', vault: second, encryption: { mode: 'none' } };
    }
    if (kitFile === undefined || agentKeyFile === undefined)
      throw invalid(
        'A vault is encrypted: give --kit-file and --agent-key-file, or --no-encryption',
      );
    return {
      kind: 'vault-init',
      vault: second,
      encryption: { mode: 'encrypted', kitFile, agentKeyFile },
    };
  }
  if (action === 'key') return keyCommand(second, tail);
  throw invalid(
    'Usage: vault init <dir> … | vault key <list|verify|add-recovery|rotate-agent|remove>',
  );
}

function keyCommand(action: string | undefined, rest: readonly string[]): BackupCommand {
  const values = flags(rest, {
    '--vault': 'value',
    '--key-file': 'value',
    '--kit-file': 'value',
    '--agent-key-file': 'value',
    '--slot': 'value',
  });
  const vault = required(values, '--vault');
  const keyFile = text(values, '--key-file');
  const only = (...names: string[]) => {
    for (const name of ['--key-file', '--kit-file', '--agent-key-file', '--slot'])
      if (values.has(name) && !names.includes(name)) throw invalid(`${name} does not apply`);
  };
  const withKey = (operation: KeyOperation): BackupCommand => ({
    kind: 'vault-key',
    vault,
    operation,
    ...(keyFile === undefined ? {} : { keyFile }),
  });
  switch (action) {
    case 'list':
      only();
      return withKey({ action: 'list' });
    case 'verify':
      only('--key-file');
      return withKey({ action: 'verify' });
    case 'add-recovery':
      only('--key-file', '--kit-file');
      return withKey({ action: 'add-recovery', kitFile: required(values, '--kit-file') });
    case 'rotate-agent':
      only('--key-file', '--agent-key-file');
      return withKey({
        action: 'rotate-agent',
        agentKeyFile: required(values, '--agent-key-file'),
      });
    case 'remove': {
      only('--key-file', '--slot');
      const slotId = required(values, '--slot');
      if (!/^[0-9a-f]{16}$/.test(slotId)) throw invalid('Invalid key slot id');
      return withKey({ action: 'remove', slotId });
    }
    case undefined:
    default:
      throw invalid(
        'Usage: vault key <list|verify|add-recovery|rotate-agent|remove> --vault <dir>',
      );
  }
}

function restore(rest: readonly string[]): BackupCommand {
  const values = flags(rest, {
    '--vault': 'value',
    '--key-file': 'value',
    '--point': 'value',
    '--database-url': 'value',
    '--storage': 'value',
    '--yes': 'switch',
    '--report': 'value',
  });
  const databaseUrl = text(values, '--database-url');
  const report = text(values, '--report');
  const keyFile = text(values, '--key-file');
  return {
    kind: 'restore',
    vault: required(values, '--vault'),
    ...(keyFile === undefined ? {} : { keyFile }),
    pointId: point(required(values, '--point')),
    storage: required(values, '--storage'),
    confirmed: values.has('--yes'),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(report === undefined ? {} : { report }),
  };
}

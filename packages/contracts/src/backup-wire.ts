import { integer, items, record, text } from './wire-values.js';

/*
 * Wire contract of unattended backups (ADR 0056). Byte counts are decimal strings, times ISO
 * 8601 UTC. Enumerations equal the domain sets (checked by a unit test); readers still accept
 * only these values, so a new value is a contract change of SDK and server together.
 */
export const backupPermissionNames = ['backup.read', 'backup.manage'] as const;
export type BackupPermissionName = (typeof backupPermissionNames)[number];
export const backupJobKinds = ['capture', 'verify', 'retention'] as const;
export type BackupJobKind = (typeof backupJobKinds)[number];
export const backupJobStateNames = [
  'queued',
  'running',
  'committing',
  'completed',
  'failed',
  'interrupted',
] as const;
export type BackupJobStateName = (typeof backupJobStateNames)[number];
export const backupVerifyDepths = ['structural', 'deep'] as const;
export const backupRetentionReasonNames = [
  'daily',
  'weekly',
  'monthly',
  'pinned',
  'newest',
] as const;
export type BackupRetentionReasonName = (typeof backupRetentionReasonNames)[number];
export const backupWarningNames = [
  'vault_not_configured',
  'agent_offline',
  'schedule_disabled',
  'no_backup_yet',
  'backup_stale',
  'last_run_failed',
  'vault_unavailable',
  'vault_low_space',
  'verify_failed',
  'never_deep_verified',
] as const;
export type BackupWarningName = (typeof backupWarningNames)[number];
export const backupRetentionMaximum = { daily: 366, weekly: 260, monthly: 120 } as const;
export const MAX_BACKUP_PAGE = 100;

export interface BackupRetentionPolicyResponse {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}
export interface BackupPlanResponse {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly timezone: string;
  readonly retention: BackupRetentionPolicyResponse;
  readonly revision: number;
}
export interface BackupPlanUpdateRequest extends Omit<BackupPlanResponse, 'revision'> {
  readonly expectedRevision: number;
}
export interface BackupPointResponse {
  readonly id: string;
  readonly snapshotAt: string;
  readonly completedAt: string;
  readonly blobs: number;
  readonly contentBytes: string;
  readonly newBytes: string;
  readonly tables: number;
  readonly rows: number;
  readonly pinned: boolean;
  readonly verifiedAt: string | null;
  readonly verifyDepth: 'structural' | 'deep' | null;
  readonly verifyError: string | null;
}
export interface BackupJobResponse {
  readonly id: string;
  readonly kind: BackupJobKind;
  readonly state: BackupJobStateName;
  readonly phase: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
  readonly pointId: string | null;
  readonly progress: {
    readonly bytesCopied: string;
    readonly bytesTotal: string;
    readonly blobsCopied: number;
    readonly blobsTotal: number;
  };
}
export interface BackupStatusResponse {
  readonly vault: {
    readonly configured: boolean;
    readonly id: string | null;
    readonly available: boolean;
    readonly freeBytes: string | null;
    readonly totalBytes: string | null;
  };
  readonly agent: {
    readonly online: boolean;
    readonly lastSeenAt: string | null;
    readonly version: string | null;
  };
  readonly plan: BackupPlanResponse;
  readonly lastCompleted: BackupPointResponse | null;
  readonly nextRunAt: string | null;
  readonly running: BackupJobResponse | null;
  readonly warnings: readonly {
    readonly code: BackupWarningName;
    readonly severity: 'warning' | 'critical';
  }[];
}
export interface BackupReceiptResponse {
  readonly id: string;
  readonly kind: BackupJobKind;
  readonly state: BackupJobStateName;
}
export interface BackupPageResponse<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
export interface BackupRetentionPreviewResponse {
  readonly keep: readonly {
    readonly id: string;
    readonly reasons: readonly BackupRetentionReasonName[];
  }[];
  readonly delete: readonly { readonly id: string }[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const decimal = /^(0|[1-9][0-9]{0,18})$/;
const machine = /^[a-z][a-z0-9_]{0,63}$/;
function member<T extends string>(value: unknown, options: readonly T[]): T {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new Error('Invalid backup value');
  return found;
}
function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null ? null : read(value);
}
function id(value: unknown): string {
  const result = text(value);
  if (!uuid.test(result)) throw new Error('Invalid backup id');
  return result;
}
function bytes(value: unknown): string {
  const result = text(value);
  if (!decimal.test(result)) throw new Error('Invalid backup byte count');
  return result;
}
function time(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result)
    throw new Error('Invalid backup time');
  return result;
}
function code(value: unknown): string {
  const result = text(value);
  if (!machine.test(result)) throw new Error('Invalid backup code');
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid backup flag');
  return value;
}
function bounded(value: unknown, max: number): number {
  const result = integer(value);
  if (result > max) throw new Error('Invalid backup number');
  return result;
}
function cursor(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value);
  if (!/^[0-9]{1,17}_[0-9a-f-]{36}$/.test(result)) throw new Error('Invalid backup cursor');
  return result;
}

export function readBackupPlan(value: unknown): BackupPlanResponse {
  const r = record(value);
  const retention = record(r['retention']);
  const zone = text(r['timezone']);
  if (zone.length < 1 || zone.length > 64) throw new Error('Invalid backup time zone');
  return {
    enabled: bool(r['enabled']),
    hour: bounded(r['hour'], 23),
    minute: bounded(r['minute'], 59),
    timezone: zone,
    retention: {
      daily: bounded(retention['daily'], backupRetentionMaximum.daily),
      weekly: bounded(retention['weekly'], backupRetentionMaximum.weekly),
      monthly: bounded(retention['monthly'], backupRetentionMaximum.monthly),
    },
    revision: bounded(r['revision'], 2147483647),
  };
}

export function readBackupPoint(value: unknown): BackupPointResponse {
  const r = record(value);
  return {
    id: id(r['id']),
    snapshotAt: time(r['snapshotAt']),
    completedAt: time(r['completedAt']),
    blobs: integer(r['blobs']),
    contentBytes: bytes(r['contentBytes']),
    newBytes: bytes(r['newBytes']),
    tables: integer(r['tables']),
    rows: integer(r['rows']),
    pinned: bool(r['pinned']),
    verifiedAt: nullable(r['verifiedAt'], time),
    verifyDepth: nullable(r['verifyDepth'], (depth) => member(depth, backupVerifyDepths)),
    verifyError: nullable(r['verifyError'], code),
  };
}

export function readBackupJob(value: unknown): BackupJobResponse {
  const r = record(value);
  const progress = record(r['progress']);
  const phase = nullable(r['phase'], code);
  return {
    id: id(r['id']),
    kind: member(r['kind'], backupJobKinds),
    state: member(r['state'], backupJobStateNames),
    phase,
    startedAt: time(r['startedAt']),
    finishedAt: nullable(r['finishedAt'], time),
    errorCode: nullable(r['errorCode'], code),
    pointId: nullable(r['pointId'], id),
    progress: {
      bytesCopied: bytes(progress['bytesCopied']),
      bytesTotal: bytes(progress['bytesTotal']),
      blobsCopied: integer(progress['blobsCopied']),
      blobsTotal: integer(progress['blobsTotal']),
    },
  };
}

function page<T>(value: unknown, read: (item: unknown) => T): BackupPageResponse<T> {
  const r = record(value);
  const list = items(r['items']);
  if (list.length > MAX_BACKUP_PAGE) throw new Error('Backup page too large');
  return { items: list.map(read), next: cursor(r['next']) };
}
export const readBackupPointPage = (value: unknown) => page(value, readBackupPoint);
export const readBackupJobPage = (value: unknown) => page(value, readBackupJob);

export function readBackupReceipt(value: unknown): BackupReceiptResponse {
  const r = record(value);
  return {
    id: id(r['id']),
    kind: member(r['kind'], backupJobKinds),
    state: member(r['state'], backupJobStateNames),
  };
}

export function readBackupStatus(value: unknown): BackupStatusResponse {
  const r = record(value);
  const vault = record(r['vault']);
  const agent = record(r['agent']);
  const warnings = items(r['warnings']);
  if (warnings.length > backupWarningNames.length) throw new Error('Invalid backup warnings');
  return {
    vault: {
      configured: bool(vault['configured']),
      id: nullable(vault['id'], id),
      available: bool(vault['available']),
      freeBytes: nullable(vault['freeBytes'], bytes),
      totalBytes: nullable(vault['totalBytes'], bytes),
    },
    agent: {
      online: bool(agent['online']),
      lastSeenAt: nullable(agent['lastSeenAt'], time),
      version: nullable(agent['version'], (version) => text(version).slice(0, 64)),
    },
    plan: readBackupPlan(r['plan']),
    lastCompleted: nullable(r['lastCompleted'], readBackupPoint),
    nextRunAt: nullable(r['nextRunAt'], time),
    running: nullable(r['running'], readBackupJob),
    warnings: warnings.map((item) => {
      const warning = record(item);
      return {
        code: member(warning['code'], backupWarningNames),
        severity: member(warning['severity'], ['warning', 'critical'] as const),
      };
    }),
  };
}

export function readBackupRetentionPreview(value: unknown): BackupRetentionPreviewResponse {
  const r = record(value);
  const keep = items(r['keep']);
  const remove = items(r['delete']);
  if (keep.length + remove.length > 10000) throw new Error('Backup preview too large');
  return {
    keep: keep.map((item) => {
      const row = record(item);
      return {
        id: id(row['id']),
        reasons: items(row['reasons']).map((reason) => member(reason, backupRetentionReasonNames)),
      };
    }),
    delete: remove.map((item) => ({ id: id(record(item)['id']) })),
  };
}

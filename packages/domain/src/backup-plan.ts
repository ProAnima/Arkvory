import { ArkvoryError } from './artifact.js';
import type { Principal } from './artifact.js';
import { MAX_ERROR_DETAILS } from './errors.js';
import type { DetailProblem, ErrorDetail } from './errors.js';
import { validTimeZone } from './backup-schedule.js';
import type { BackupSchedule } from './backup-schedule.js';
import { backupRetentionLimits, defaultBackupRetention } from './backup-retention.js';
import type { BackupRetentionPolicy } from './backup-retention.js';

/**
 * System permissions of instance backups (ADR 0056); manage implies read. They are not
 * repository actions: a repository-scoped key never receives them.
 */
export const backupPermissions = ['backup.read', 'backup.manage'] as const;
export type BackupPermission = (typeof backupPermissions)[number];

/**
 * Account administrators (sessions; personal tokens never carry the flag) and the file-based
 * owner/bootstrap key hold both permissions. Managed service keys hold none.
 */
export function grantedBackupPermissions(principal: Principal): readonly BackupPermission[] {
  if (principal.managed || principal.credential === 'personal-token') return [];
  return principal.administrator === true || principal.serviceAdministrator === true
    ? backupPermissions
    : [];
}

export function requireBackupPermission(principal: Principal, permission: BackupPermission): void {
  if (!grantedBackupPermissions(principal).includes(permission))
    throw new ArkvoryError('forbidden', 'Backup permission required', {
      reason: 'permission_missing',
    });
}

export interface BackupPlanSettings extends BackupSchedule {
  readonly retention: BackupRetentionPolicy;
}
export interface BackupPlanUpdate extends BackupPlanSettings {
  readonly expectedRevision: number;
}
/** Starting template (BACKUP_RECOVERY): daily 02:00, disabled until an operator enables it. */
export const defaultBackupPlan: BackupPlanSettings = {
  enabled: false,
  hour: 2,
  minute: 0,
  timezone: 'UTC',
  retention: defaultBackupRetention,
};
export const MAX_PLAN_REVISION = 2147483647;

class Details {
  readonly items: ErrorDetail[] = [];
  add(field: string, problem: DetailProblem): void {
    if (this.items.length < MAX_ERROR_DETAILS) this.items.push({ field, problem });
  }
}

function members(
  value: unknown,
  names: readonly string[],
  prefix: string,
  details: Details,
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    details.add(prefix || '/', value === undefined ? 'required' : 'type');
    return null;
  }
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  for (const key of Object.keys(row))
    // Client-chosen names are not echoed when long; the problem is still reported.
    if (!names.includes(key))
      details.add(key.length <= 64 ? `${prefix}/${key}` : prefix || '/', 'unknown_field');
  for (const name of names)
    if (row[name] === undefined) details.add(`${prefix}/${name}`, 'required');
  return row;
}

function integer(
  row: Record<string, unknown>,
  name: string,
  max: number,
  field: string,
  details: Details,
): number {
  const value = row[name];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) details.add(field, 'type');
  else if (value < 0 || value > max) details.add(field, 'range');
  return typeof value === 'number' ? value : 0;
}

/**
 * Closed body of PUT /backup/plan. Every problem is reported at once with a JSON Pointer to its
 * member, so a form can mark all invalid fields; values are never echoed.
 */
export function parseBackupPlanUpdate(value: unknown): BackupPlanUpdate {
  const details = new Details();
  const names = ['expectedRevision', 'enabled', 'hour', 'minute', 'timezone', 'retention'];
  const row = members(value, names, '', details) ?? {};
  const expectedRevision = integer(
    row,
    'expectedRevision',
    MAX_PLAN_REVISION,
    '/expectedRevision',
    details,
  );
  const enabled = row['enabled'];
  if (enabled !== undefined && typeof enabled !== 'boolean') details.add('/enabled', 'type');
  const hour = integer(row, 'hour', 23, '/hour', details);
  const minute = integer(row, 'minute', 59, '/minute', details);
  const timezone = row['timezone'];
  if (timezone !== undefined && typeof timezone !== 'string') details.add('/timezone', 'type');
  else if (typeof timezone === 'string' && !validTimeZone(timezone))
    details.add('/timezone', 'format');
  const retention =
    row['retention'] === undefined
      ? null
      : members(row['retention'], ['daily', 'weekly', 'monthly'], '/retention', details);
  const policy = {
    daily: retention
      ? integer(retention, 'daily', backupRetentionLimits.daily, '/retention/daily', details)
      : 0,
    weekly: retention
      ? integer(retention, 'weekly', backupRetentionLimits.weekly, '/retention/weekly', details)
      : 0,
    monthly: retention
      ? integer(retention, 'monthly', backupRetentionLimits.monthly, '/retention/monthly', details)
      : 0,
  };
  if (details.items.length || typeof timezone !== 'string' || typeof enabled !== 'boolean')
    throw new ArkvoryError('invalid_input', 'Invalid backup plan', {
      reason: 'validation',
      details: details.items.length ? details.items : [{ field: '/', problem: 'invalid' }],
    });
  return { expectedRevision, enabled, hour, minute, timezone, retention: policy };
}

/** Body of PUT /backup/points/{id}/pin. */
export function parsePinUpdate(value: unknown): boolean {
  const details = new Details();
  const pinned = members(value, ['pinned'], '', details)?.['pinned'];
  if (pinned !== undefined && typeof pinned !== 'boolean') details.add('/pinned', 'type');
  if (details.items.length || typeof pinned !== 'boolean')
    throw new ArkvoryError('invalid_input', 'Invalid pin request', {
      reason: 'validation',
      details: details.items.length ? details.items : [{ field: '/pinned', problem: 'invalid' }],
    });
  return pinned;
}

/** Idempotency-Key of backup commands: the same alphabet as capture keys of the CLI. */
export function requireBackupRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Valid Idempotency-Key required', {
      reason: 'validation',
      details: [{ field: 'Idempotency-Key', problem: value === undefined ? 'required' : 'format' }],
    });
  return value;
}

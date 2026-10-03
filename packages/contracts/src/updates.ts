import { record, integer, text } from './wire-values.js';

export const updateErrors = [
  'check_failed',
  'update_failed',
  'conflict',
  'maintenance_required',
  'recovery_required',
] as const;
export type UpdateError = (typeof updateErrors)[number];
export interface UpdateSnapshot {
  revision: number;
  currentVersion: string;
  currentSchema: number;
  automatic: boolean;
  hourUTC: number;
  pin: string | null;
  heartbeatAt: string;
  checkedAt: string | null;
  latest: { version: string; schema: number; sha256: string } | null;
  phase: 'idle' | 'checking' | 'updating' | 'failed';
  error: UpdateError | null;
  lastAttemptDay: string | null;
  lastRequestId: string | null;
  /** Anonymous statistics to the ProAnimaStudio hub (ADR 0060); absent from older updaters. */
  statistics?: boolean;
  /** The hub's update channel of this installation; absent from older updaters. */
  channel?: 'stable' | 'beta';
}
export type UpdateRequest = { id: string; expectedRevision: number } & (
  | { kind: 'check' }
  | { kind: 'apply'; version: string; sha256: string }
  | { kind: 'configure'; automatic: boolean; hourUTC: number; statistics?: boolean }
);
export function updateVersion(value: unknown): string {
  const result = text(value);
  if (!/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(result))
    throw new Error('Invalid stable version');
  return result;
}
const number = (value: unknown, max: number) => {
  const result = integer(value);
  if (result < 0 || result > max) throw new Error('Invalid update number');
  return result;
};
const bool = (value: unknown) => {
  if (typeof value !== 'boolean') throw new Error('Invalid update switch');
  return value;
};
const digest = (value: unknown) => {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error('Invalid release digest');
  return result;
};
const id = (value: unknown) => {
  const result = text(value);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result))
    throw new Error('Invalid request identity');
  return result;
};
const date = (value: unknown) => {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result)
    throw new Error('Invalid update time');
  return result;
};
export function readUpdateRequest(value: unknown): UpdateRequest {
  const r = record(value);
  const base = { id: id(r['id']), expectedRevision: number(r['expectedRevision'], 2147483646) };
  const kind = r['kind'];
  const keys =
    kind === 'apply'
      ? ['version', 'sha256']
      : kind === 'configure'
        ? ['automatic', 'hourUTC', 'statistics']
        : [];
  if (Object.keys(r).some((key) => !['id', 'expectedRevision', 'kind', ...keys].includes(key)))
    throw new Error('Unknown update field');
  if (kind === 'check') return { ...base, kind };
  if (kind === 'apply')
    return { ...base, kind, version: updateVersion(r['version']), sha256: digest(r['sha256']) };
  if (kind === 'configure')
    return {
      ...base,
      kind,
      automatic: bool(r['automatic']),
      hourUTC: number(r['hourUTC'], 23),
      ...('statistics' in r ? { statistics: bool(r['statistics']) } : {}),
    };
  throw new Error('Invalid update operation');
}
export function readUpdateSnapshot(value: unknown): UpdateSnapshot {
  const r = record(value),
    latest = r['latest'] === null ? null : record(r['latest']);
  const phase = r['phase'];
  if (phase !== 'idle' && phase !== 'checking' && phase !== 'updating' && phase !== 'failed')
    throw new Error('Invalid update phase');
  const error = r['error'];
  if (error !== null && !updateErrors.some((item) => item === error))
    throw new Error('Invalid update error');
  const day = r['lastAttemptDay'];
  if (day !== null && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)))
    throw new Error('Invalid update day');
  return {
    revision: number(r['revision'], 2147483646),
    currentVersion: updateVersion(r['currentVersion']),
    currentSchema: number(r['currentSchema'], 2147483647),
    automatic: bool(r['automatic']),
    hourUTC: number(r['hourUTC'], 23),
    pin: r['pin'] === null ? null : updateVersion(r['pin']),
    heartbeatAt: date(r['heartbeatAt']),
    checkedAt: r['checkedAt'] === null ? null : date(r['checkedAt']),
    latest:
      latest === null
        ? null
        : {
            version: updateVersion(latest['version']),
            schema: number(latest['schema'], 2147483647),
            sha256: digest(latest['sha256']),
          },
    phase,
    error: error as UpdateError | null,
    lastAttemptDay: day,
    lastRequestId: r['lastRequestId'] === null ? null : id(r['lastRequestId']),
    ...('statistics' in r ? { statistics: bool(r['statistics']) } : {}),
    ...('channel' in r ? { channel: channelOf(r['channel']) } : {}),
  };
}
function channelOf(value: unknown): 'stable' | 'beta' {
  if (value !== 'stable' && value !== 'beta') throw new Error('Invalid update channel');
  return value;
}

import { ArkvoryError } from './artifact.js';
import { fieldError, nestedFields, withField } from './errors.js';
import { retentionObject, annotationRevision } from './retention.js';

export interface StoragePolicy {
  enabled: boolean;
  grouping: 'package-channel' | 'package' | 'repository';
  keepLast: number;
  channels: readonly { label: string; keepLast: number }[];
  protectedLabels: readonly string[];
  minAgeHours: number;
  intervalMinutes: number;
  quotaBytes: string | null;
  warningPercent: number;
  criticalPercent: number;
}
export function defaultStoragePolicy(): StoragePolicy {
  return {
    enabled: false,
    grouping: 'package-channel',
    keepLast: 10,
    channels: [
      { label: 'test', keepLast: 10 },
      { label: 'staging', keepLast: 10 },
      { label: 'release', keepLast: 10 },
    ],
    protectedLabels: ['bse', 'release'],
    minAgeHours: 24,
    intervalMinutes: 60,
    quotaBytes: null,
    warningPercent: 80,
    criticalPercent: 95,
  };
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new ArkvoryError(
      'invalid_input',
      `Integer between ${String(min)} and ${String(max)} required`,
    );
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_.:-]{1,64}$/u.test(value))
    throw new ArkvoryError('invalid_input', 'Invalid policy label');
  return value;
}
export function parseStoragePolicy(value: unknown): StoragePolicy {
  const r = retentionObject(value, Object.keys(defaultStoragePolicy()));
  const enabled = r['enabled'],
    grouping = r['grouping'],
    quotaBytes = r['quotaBytes'];
  if (
    typeof enabled !== 'boolean' ||
    (grouping !== 'package-channel' && grouping !== 'package' && grouping !== 'repository')
  )
    throw new ArkvoryError('invalid_input', 'Invalid storage policy mode');
  if (
    quotaBytes !== null &&
    (typeof quotaBytes !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(quotaBytes) ||
      BigInt(quotaBytes) > 9007199254740991n)
  )
    throw fieldError('/quotaBytes', 'format', 'Invalid decimal quotaBytes');
  const rawChannels: unknown = r['channels'],
    rawLabels: unknown = r['protectedLabels'];
  if (
    !Array.isArray(rawChannels) ||
    rawChannels.length > 32 ||
    !Array.isArray(rawLabels) ||
    rawLabels.length > 32
  )
    throw new ArkvoryError('invalid_input', 'At most 32 channels and protected labels allowed');
  const channels = rawChannels.map((v: unknown) => {
    const c = retentionObject(v, ['label', 'keepLast']);
    return { label: label(c['label']), keepLast: number(c['keepLast'], 1, 100000) };
  });
  const protectedLabels = rawLabels.map(label);
  if (
    new Set(channels.map((c) => c.label)).size !== channels.length ||
    new Set(protectedLabels).size !== protectedLabels.length
  )
    throw new ArkvoryError('invalid_input', 'Duplicate policy labels');
  const warningPercent = withField('/warningPercent', () => number(r['warningPercent'], 1, 98)),
    criticalPercent = withField('/criticalPercent', () => number(r['criticalPercent'], 2, 99));
  if (warningPercent >= criticalPercent)
    throw fieldError('/warningPercent', 'range', 'Warning must precede critical threshold');
  return {
    enabled,
    grouping,
    quotaBytes,
    channels,
    protectedLabels,
    warningPercent,
    criticalPercent,
    keepLast: withField('/keepLast', () => number(r['keepLast'], 1, 100000)),
    minAgeHours: withField('/minAgeHours', () => number(r['minAgeHours'], 0, 87600)),
    intervalMinutes: withField('/intervalMinutes', () => number(r['intervalMinutes'], 1, 10080)),
  };
}
export function parseStoragePolicyUpdate(value: unknown) {
  const r = retentionObject(value, ['expectedRevision', 'policy']);
  return {
    expectedRevision: annotationRevision(r['expectedRevision']),
    policy: nestedFields('/policy', () => parseStoragePolicy(r['policy'])),
  };
}
export type CapacityState = 'unlimited' | 'normal' | 'warning' | 'critical' | 'exceeded';
export function capacityState(used: string, policy: StoragePolicy): CapacityState {
  if (policy.quotaBytes === null) return 'unlimited';
  const bytes = BigInt(used),
    quota = BigInt(policy.quotaBytes);
  if (bytes >= quota) return 'exceeded';
  if (bytes * 100n >= quota * BigInt(policy.criticalPercent)) return 'critical';
  if (bytes * 100n >= quota * BigInt(policy.warningPercent)) return 'warning';
  return 'normal';
}

import { ArkvoryError } from './artifact.js';
import { retentionObject } from './retention.js';

export interface CleanupPolicy {
  enabled: boolean;
  graceHours: number;
  batchSize: number;
  intervalSeconds: number;
  delayMilliseconds: number;
}
export const defaultCleanupPolicy: CleanupPolicy = {
  enabled: false,
  graceHours: 24,
  batchSize: 25,
  intervalSeconds: 60,
  delayMilliseconds: 50,
};
export function parseCleanupPolicy(value: unknown): CleanupPolicy {
  const r = retentionObject(value, Object.keys(defaultCleanupPolicy));
  const bounded = (key: string, min: number, max: number): number => {
    const n = r[key];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
      throw new ArkvoryError('invalid_input', 'Invalid cleanup policy');
    return n;
  };
  if (typeof r['enabled'] !== 'boolean')
    throw new ArkvoryError('invalid_input', 'Invalid cleanup switch');
  return {
    enabled: r['enabled'],
    graceHours: bounded('graceHours', 0, 8760),
    batchSize: bounded('batchSize', 1, 100),
    intervalSeconds: bounded('intervalSeconds', 5, 86400),
    delayMilliseconds: bounded('delayMilliseconds', 0, 1000),
  };
}

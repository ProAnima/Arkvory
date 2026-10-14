import { fieldError } from './errors.js';
import {
  downloadClasses,
  downloadSchedulePolicy,
  downloadStrategies,
  type DownloadClass,
  type DownloadSchedulePolicy,
  type DownloadStrategy,
} from './download-policy.js';

/**
 * The queue settings an administrator may change while the server runs (ADR 0076, stage 3), in
 * the units people use. Limits that size memory at start (queue length, hold) are not here.
 */
export interface DownloadSettingValues {
  readonly strategy: DownloadStrategy;
  readonly sessions: number;
  readonly reserve: number;
  readonly perPrincipal: number;
  readonly weights: Readonly<Record<DownloadClass, number>>;
  readonly sessionMinBytes: number;
  readonly idleSeconds: number;
  readonly agingMinutes: number;
  readonly preempt: boolean;
  readonly rangesPerSession: number;
}

/** Changed values only; a missing field keeps what the environment of the server sets. */
export type DownloadOverrides = Partial<DownloadSettingValues>;

export const downloadSettingNames = [
  'strategy',
  'sessions',
  'reserve',
  'perPrincipal',
  'weights',
  'sessionMinBytes',
  'idleSeconds',
  'agingMinutes',
  'preempt',
  'rangesPerSession',
] as const satisfies readonly (keyof DownloadSettingValues)[];

export function downloadSettingValues(policy: DownloadSchedulePolicy): DownloadSettingValues {
  return {
    strategy: policy.strategy,
    sessions: policy.slots,
    reserve: policy.interactiveReserve,
    perPrincipal: policy.perPrincipalActive,
    weights: policy.weights,
    sessionMinBytes: policy.sessionMinBytes,
    idleSeconds: policy.idleMs / 1000,
    agingMinutes: policy.agingMs / 60000,
    preempt: policy.preempt,
    rangesPerSession: policy.rangesPerSession,
  };
}

/**
 * The policy with `overrides` over the policy the server started with. Fields depending on the
 * number of sessions follow it when only `sessions` changes: a reserve or a share that no longer
 * fits is lowered to fit, never silently raised. Breaking a rule is `invalid_input`.
 */
export function overrideDownloadPolicy(
  base: DownloadSchedulePolicy,
  overrides: DownloadOverrides,
): DownloadSchedulePolicy {
  const slots = overrides.sessions ?? base.slots;
  const reserve = overrides.reserve ?? Math.min(base.interactiveReserve, Math.max(0, slots - 1));
  const perPrincipal = overrides.perPrincipal ?? Math.min(base.perPrincipalActive, slots);
  return downloadSchedulePolicy(slots, {
    ...base,
    slots,
    interactiveReserve: reserve,
    perPrincipalActive: perPrincipal,
    ...(overrides.strategy === undefined ? {} : { strategy: overrides.strategy }),
    ...(overrides.weights === undefined ? {} : { weights: overrides.weights }),
    ...(overrides.sessionMinBytes === undefined
      ? {}
      : { sessionMinBytes: overrides.sessionMinBytes }),
    ...(overrides.idleSeconds === undefined ? {} : { idleMs: overrides.idleSeconds * 1000 }),
    ...(overrides.agingMinutes === undefined ? {} : { agingMs: overrides.agingMinutes * 60000 }),
    ...(overrides.preempt === undefined ? {} : { preempt: overrides.preempt }),
    ...(overrides.rangesPerSession === undefined
      ? {}
      : { rangesPerSession: overrides.rangesPerSession }),
  });
}

const whole = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw fieldError(
      `/${name}`,
      typeof value === 'number' ? 'range' : 'type',
      `${name} must be a whole number from ${String(minimum)} to ${String(maximum)}`,
    );
  return value;
};

function weightsOf(value: unknown): Record<DownloadClass, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw fieldError('/weights', 'invalid', 'weights must name every class');
  const entries = Object.entries(value);
  if (
    entries.length !== downloadClasses.length ||
    !entries.every(([name]) => downloadClasses.some((known) => known === name))
  )
    throw fieldError('/weights', 'invalid', 'weights must name every class');
  const weights: Partial<Record<DownloadClass, number>> = {};
  for (const [name, weight] of entries)
    for (const known of downloadClasses)
      if (known === name) weights[known] = whole(weight, `weights/${known}`, 1, 1000);
  return {
    interactive: weights.interactive ?? 1,
    release: weights.release ?? 1,
    bulk: weights.bulk ?? 1,
    background: weights.background ?? 1,
  };
}

/** Overrides from untrusted JSON: known fields with their own types, nothing else. */
export function readDownloadOverrides(value: unknown): DownloadOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw fieldError('/', 'type', 'overrides must be an object');
  const found: Record<string, unknown> = { ...value };
  for (const name of Object.keys(found))
    if (!downloadSettingNames.some((known) => known === name))
      throw fieldError(`/${name}`, 'unknown_field', `Unknown download setting: ${name}`);
  const strategy = found['strategy'];
  if (strategy !== undefined && !downloadStrategies.some((known) => known === strategy))
    throw fieldError('/strategy', 'invalid', 'strategy is not known');
  const preempt = found['preempt'];
  if (preempt !== undefined && typeof preempt !== 'boolean')
    throw fieldError('/preempt', 'type', 'preempt must be true or false');
  const result: { -readonly [K in keyof DownloadSettingValues]?: DownloadSettingValues[K] } = {};
  const known = downloadStrategies.find((name) => name === strategy);
  if (known) result.strategy = known;
  if (typeof preempt === 'boolean') result.preempt = preempt;
  if (found['weights'] !== undefined) result.weights = weightsOf(found['weights']);
  const numbers = [
    ['sessions', 1, 1024],
    ['reserve', 0, 1023],
    ['perPrincipal', 1, 1024],
    ['sessionMinBytes', 0, Number.MAX_SAFE_INTEGER],
    ['idleSeconds', 1, 3600],
    ['agingMinutes', 0, 10080],
    ['rangesPerSession', 1, 64],
  ] as const;
  for (const [name, minimum, maximum] of numbers)
    if (found[name] !== undefined) result[name] = whole(found[name], name, minimum, maximum);
  return result;
}

/**
 * Stored overrides as this release understands them: fields of a newer release are left out (it
 * may have saved them before a rollback); the known ones must still be valid.
 */
export function knownDownloadOverrides(value: unknown): DownloadOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return readDownloadOverrides(value);
  const known = Object.entries(value).filter(([name]) =>
    downloadSettingNames.some((item) => item === name),
  );
  return readDownloadOverrides(Object.fromEntries(known));
}

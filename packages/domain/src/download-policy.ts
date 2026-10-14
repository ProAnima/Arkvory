import { ArkvoryError } from './artifact.js';

/** Priority classes, highest first (ADR 0076). */
export const downloadClasses = ['interactive', 'release', 'bulk', 'background'] as const;
export type DownloadClass = (typeof downloadClasses)[number];
export const downloadStrategies = ['ordered', 'smallest-first', 'shared'] as const;
export type DownloadStrategy = (typeof downloadStrategies)[number];

export interface DownloadSchedulePolicy {
  readonly strategy: DownloadStrategy;
  /** Sessions that move bytes at once. */
  readonly slots: number;
  readonly weights: Readonly<Record<DownloadClass, number>>;
  /** Places only `interactive` may take, so people are served during a mass update. */
  readonly interactiveReserve: number;
  /** Active sessions of one principal while sessions of other principals wait. */
  readonly perPrincipalActive: number;
  /** Sessions held at all, active and waiting; beyond it a client is told to come back. */
  readonly maxSessions: number;
  readonly maxSessionsPerPrincipal: number;
  /** A pause between ranges longer than this frees the place of an active session. */
  readonly idleMs: number;
  /** Each such wait lifts a waiting session one class, up to `release`; 0 turns aging off. */
  readonly agingMs: number;
  /**
   * A client that follows the queue protocol may be asked at a range boundary to give its place
   * to a higher class or to a principal under its share; it resumes from where it stopped.
   */
  readonly preempt: boolean;
  /** Responses of one session in flight at once: parallel ranges, clients sharing a session. */
  readonly rangesPerSession: number;
  /** Objects up to this size are admitted per request, outside the queue. */
  readonly sessionMinBytes: number;
}

const second = 1000;
const minute = 60 * second;
export const DEFAULT_DOWNLOAD_WEIGHTS: Readonly<Record<DownloadClass, number>> = {
  interactive: 8,
  release: 4,
  bulk: 2,
  background: 1,
};

/**
 * The safe defaults of ADR 0076 for `slots` sessions; every field can be overridden. A reserve
 * for people needs enough places to spare one: from four places on.
 */
export function downloadSchedulePolicy(
  slots: number,
  overrides: Partial<DownloadSchedulePolicy> = {},
): DownloadSchedulePolicy {
  const policy: DownloadSchedulePolicy = {
    strategy: 'ordered',
    slots,
    weights: DEFAULT_DOWNLOAD_WEIGHTS,
    interactiveReserve: slots >= 4 ? 1 : 0,
    perPrincipalActive: Math.min(4, slots),
    maxSessions: 65536,
    maxSessionsPerPrincipal: 4096,
    idleMs: 30 * second,
    agingMs: 15 * minute,
    preempt: true,
    rangesPerSession: 4,
    sessionMinBytes: 16 * 1024 * 1024,
    ...overrides,
  };
  const problem = policyProblem(policy);
  if (problem) throw new ArkvoryError('invalid_input', `Invalid download schedule: ${problem}`);
  return policy;
}

const whole = (value: number, minimum: number, maximum: number) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;

/** The first rule the policy breaks, named by its field, or undefined. */
function policyProblem(policy: DownloadSchedulePolicy): string | undefined {
  const rules: [boolean, string][] = [
    [downloadStrategies.includes(policy.strategy), 'strategy is not known'],
    [whole(policy.slots, 1, 1024), 'slots must be 1 to 1024'],
    [
      whole(policy.interactiveReserve, 0, policy.slots - 1),
      'interactiveReserve must be below slots',
    ],
    [whole(policy.perPrincipalActive, 1, policy.slots), 'perPrincipalActive must be 1 to slots'],
    [whole(policy.maxSessions, 1, 1_048_576), 'maxSessions must be 1 to 1048576'],
    [
      whole(policy.maxSessionsPerPrincipal, 1, policy.maxSessions),
      'maxSessionsPerPrincipal must be 1 to maxSessions',
    ],
    [whole(policy.idleMs, second, 3600 * second), 'idleMs must be 1 s to 1 h'],
    [
      policy.agingMs === 0 || whole(policy.agingMs, minute, 7 * 24 * 60 * minute),
      'agingMs must be 0 or 1 min to 7 days',
    ],
    [typeof policy.preempt === 'boolean', 'preempt must be true or false'],
    [whole(policy.rangesPerSession, 1, 64), 'rangesPerSession must be 1 to 64'],
    [
      whole(policy.sessionMinBytes, 0, Number.MAX_SAFE_INTEGER),
      'sessionMinBytes must be 0 or more',
    ],
    [
      downloadClasses.every((name) => whole(policy.weights[name], 1, 1000)),
      'weights must be 1 to 1000 for every class',
    ],
  ];
  return rules.find(([valid]) => !valid)?.[1];
}

/** `interactive=8,bulk=1`: named classes change, the others keep their default weight. */
export function parseDownloadWeights(value: string): Record<DownloadClass, number> {
  const weights = { ...DEFAULT_DOWNLOAD_WEIGHTS };
  for (const entry of value.split(',')) {
    const [name = '', weight = ''] = entry.split('=').map((part) => part.trim());
    const known = downloadClasses.find((item) => item === name);
    if (!known || !/^[1-9][0-9]{0,3}$/.test(weight))
      throw new ArkvoryError('invalid_input', `Invalid download weight: ${entry.trim()}`);
    weights[known] = Number(weight);
  }
  return weights;
}

/**
 * The class a caller downloads in. It may ask for a lower class than its own, never a higher
 * one; an unknown name is refused rather than ignored, so a typo is not silently dropped.
 */
export function requestedDownloadClass(own: DownloadClass, asked: unknown): DownloadClass {
  if (asked === undefined) return own;
  const name = typeof asked === 'string' ? asked.trim().toLowerCase() : '';
  const index = downloadClasses.findIndex((item) => item === name);
  if (index < 0)
    throw new ArkvoryError(
      'invalid_input',
      `Arkvory-Download-Class must be one of ${downloadClasses.join(', ')}`,
    );
  return index > downloadClasses.indexOf(own) ? (downloadClasses[index] ?? own) : own;
}

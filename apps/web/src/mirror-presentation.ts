import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import type { MessageKey } from './messages.js';

export type MirrorState = 'synced' | 'behind' | 'pending' | 'seeding' | 'failing';

/**
 * The state a badge shows. `mirror_source_behind` is no failure: the mirror reads a restored
 * source again and says why, so it shows as the first copy with its reason below.
 */
export function mirrorState(status: RepositoryMirrorResponse): MirrorState {
  if (status.errorCode !== null && status.errorCode !== 'mirror_source_behind') return 'failing';
  if (status.phase === 'pending') return 'pending';
  if (status.phase === 'seeding') return 'seeding';
  return status.caughtUp === true ? 'synced' : 'behind';
}

export const stateKeys: Readonly<Record<MirrorState, MessageKey>> = {
  synced: 'mirrorStateSynced',
  behind: 'mirrorStateBehind',
  pending: 'mirrorStatePending',
  seeding: 'mirrorStateSeeding',
  failing: 'mirrorStateFailing',
};

/** What stopped the synchronization, the next step, and a command when one fixes it. */
export interface MirrorReason {
  readonly key: MessageKey;
  readonly params: Readonly<Record<string, string>>;
  readonly command: string | null;
}

const reasons: Readonly<Record<string, MessageKey>> = {
  unauthorized: 'mirrorReasonUnauthorized',
  forbidden: 'mirrorReasonForbidden',
  not_found: 'mirrorReasonNotFound',
  mirror_unreachable: 'mirrorReasonUnreachable',
  unavailable: 'mirrorReasonUnreachable',
  busy: 'mirrorReasonUnreachable',
  rate_limited: 'mirrorReasonUnreachable',
  mirror_certificate: 'mirrorReasonCertificate',
  capacity_exceeded: 'mirrorReasonCapacity',
  mirror_source_behind: 'mirrorReasonSourceBehind',
  mirror_mismatch: 'mirrorReasonMismatch',
  mirror_source_changed: 'mirrorReasonSourceChanged',
  mirror_delete_blocked: 'mirrorReasonDeleteBlocked',
  mirror_detached: 'mirrorReasonDetached',
  mirror_package_conflict: 'mirrorReasonPackage',
  mirror_id_taken: 'mirrorReasonIdTaken',
};

/** Commands keep their placeholders in angle brackets: the root and files are the operator's. */
function commandFor(code: string, repository: string): string | null {
  const base = `arkvory configure --root <root> --mirror ${repository} --mirror-token-file <key file>`;
  if (code === 'unauthorized') return base;
  if (code === 'mirror_certificate') return `${base} --mirror-ca-file <ca.pem>`;
  return null;
}

export function mirrorReason(status: RepositoryMirrorResponse): MirrorReason | null {
  const code = status.errorCode;
  if (code === null) return null;
  return {
    key: reasons[code] ?? 'mirrorReasonOther',
    params: { source: status.sourceRepository, upstream: hostOf(status.upstream), code },
    command: commandFor(code, status.repository),
  };
}

/** The source's host for people; the full address stays in the API. */
export function hostOf(upstream: string): string {
  try {
    return new URL(upstream).host;
  } catch {
    return upstream;
  }
}

/** The stages of an import as a list in the page's language (“a, b or c”): any one of them counts. */
export function stageList(stages: readonly string[]): string {
  const language = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';
  return new Intl.ListFormat(language, { type: 'disjunction' }).format(stages);
}

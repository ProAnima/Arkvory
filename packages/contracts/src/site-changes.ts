import { record, text } from './wire-values.js';

/**
 * Changes a site's privileged agent applies (ADR 0077, stage F3): mirrors and import, HA. The
 * API only queues them in the updater mailbox (ADR 0038); the agent applies them with the code
 * of `arkvory configure` and `cluster-*`, with their checks and rollback.
 */
export type SiteChange =
  | {
      readonly kind: 'mirror-attach';
      readonly repository: string;
      readonly upstream: string;
      readonly sourceRepository: string;
      /** Import mode with these stages; null mirrors the repository as it is. */
      readonly stages: readonly string[] | null;
    }
  | { readonly kind: 'mirror-key'; readonly repository: string }
  | { readonly kind: 'mirror-detach'; readonly repositories: readonly string[] }
  | {
      readonly kind: 'cluster-switchover';
      readonly node: string;
      /** The node name typed again: a switchover is never one click. */
      readonly confirm: string;
    }
  | {
      readonly kind: 'single-copy';
      /** Until when one copy acknowledges writes; null withdraws the decision. */
      readonly until: string | null;
      readonly reason: string;
    };
export type SiteChangeKind = SiteChange['kind'];
export const siteChangeKinds = [
  'mirror-attach',
  'mirror-key',
  'mirror-detach',
  'cluster-switchover',
  'single-copy',
] as const satisfies readonly SiteChangeKind[];

/** What the API puts in the mailbox; the source key, when any, lies beside it in its own file. */
export interface SiteChangeRequest {
  readonly id: string;
  /** SHA-256 of the change as sent: the same id with another change is refused, not repeated. */
  readonly digest: string;
  /** Server time of the request: the agent refuses one older than five minutes. */
  readonly requestedAt: string;
  readonly actor: string;
  readonly change: SiteChange;
}

export type SiteChangeState = 'pending' | 'applying' | 'done' | 'failed';
export interface SiteChangeRecord {
  readonly id: string;
  readonly digest: string;
  readonly kind: SiteChangeKind;
  readonly state: SiteChangeState;
  /**
   * Why it failed, as a code: the agent's own words name hosts and files and stay in its log on
   * the site, never with a controller.
   */
  readonly error: SiteChangeError | null;
  readonly actor: string;
  readonly requestedAt: string;
  readonly finishedAt: string | null;
}
/** What the agent reports in the mailbox status. */
export interface SiteChangeStatus {
  readonly heartbeatAt: string;
  /**
   * A change was interrupted half done: the agent takes no other until an operator checked the
   * site and ran `arkvory changes-reset` there. Null otherwise.
   */
  readonly blocked: SiteChangeError | null;
  /** Newest first, at most 20. */
  readonly recent: readonly SiteChangeRecord[];
}

const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const stagePattern = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
const nodePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
export const siteChangeErrors = [
  'expired',
  'interrupted',
  'key_missing',
  'not_a_mirror',
  'already_attached',
  'mirror_failed',
  'switchover_failed',
  'single_copy_failed',
  'unreadable',
  'digest_mismatch',
] as const;
export type SiteChangeError = (typeof siteChangeErrors)[number];
/**
 * How long a request may wait for the agent: HA decisions are about the cluster as it was when
 * asked, five minutes; mirror changes may wait out an update of the site.
 */
export function siteChangeTtlMs(kind: SiteChangeKind): number {
  return kind === 'cluster-switchover' || kind === 'single-copy' ? 5 * 60 * 1000 : 30 * 60 * 1000;
}

const problem = (message: string) => new Error(message);
function only(row: Record<string, unknown>, names: readonly string[]) {
  for (const name of Object.keys(row))
    if (!names.includes(name)) throw problem(`Unknown field: ${name}`);
}
function repository(value: unknown) {
  if (typeof value !== 'string' || !repositoryPattern.test(value))
    throw problem('A repository name is required');
  return value;
}
/** An HTTPS origin, or HTTP on loopback; the agent checks it again as `--mirror-upstream`. */
const originPattern =
  /^(?:https:\/\/[a-z0-9.-]{1,253}|https:\/\/\[[0-9a-f:]{2,39}\]|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]))(?::[0-9]{1,5})?$/;
function upstream(value: unknown) {
  const origin = typeof value === 'string' ? value.toLowerCase().replace(/\/$/, '') : '';
  if (!originPattern.test(origin)) throw problem('upstream is an HTTPS origin without a path');
  return origin;
}
function stages(value: unknown) {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16 ||
    new Set(value).size !== value.length ||
    !value.every((stage) => typeof stage === 'string' && stagePattern.test(stage))
  )
    throw problem('stages lists 1 to 16 distinct stage names, or is null');
  return value.map((stage) => text(stage));
}
function node(value: unknown) {
  if (typeof value !== 'string' || !nodePattern.test(value)) throw problem('node is a node name');
  return value;
}

/** A change from untrusted JSON: one known kind with its own fields, nothing else. */
export function readSiteChange(value: unknown): SiteChange {
  const row = record(value);
  switch (row['kind']) {
    case 'mirror-attach':
      // An authority of the source is trusted for every mirror of the site: it stays a local
      // decision (`arkvory configure --mirror-ca-file`), never a remote one.
      only(row, ['kind', 'repository', 'upstream', 'sourceRepository', 'stages']);
      return {
        kind: 'mirror-attach',
        repository: repository(row['repository']),
        upstream: upstream(row['upstream']),
        sourceRepository: repository(row['sourceRepository']),
        stages: stages(row['stages'] ?? null),
      };
    case 'mirror-key':
      only(row, ['kind', 'repository']);
      return { kind: 'mirror-key', repository: repository(row['repository']) };
    case 'mirror-detach': {
      only(row, ['kind', 'repositories']);
      const list = row['repositories'];
      if (!Array.isArray(list) || list.length === 0 || list.length > 64)
        throw problem('repositories lists 1 to 64 repositories');
      const names = list.map(repository);
      // `all` means every mirror to `arkvory configure`: remotely each one is named.
      if (names.includes('all') || new Set(names).size !== names.length)
        throw problem('repositories names each mirror once; all is not a name here');
      return { kind: 'mirror-detach', repositories: names };
    }
    case 'cluster-switchover': {
      only(row, ['kind', 'node', 'confirm']);
      const target = node(row['node']);
      if (row['confirm'] !== target) throw problem('confirm must repeat the node name');
      return { kind: 'cluster-switchover', node: target, confirm: target };
    }
    case 'single-copy': {
      only(row, ['kind', 'until', 'reason']);
      const until = row['until'];
      const reason = row['reason'];
      if (
        until !== null &&
        (typeof until !== 'string' ||
          !/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(until) ||
          !Number.isFinite(Date.parse(until)))
      )
        throw problem('until is a time with a zone, or null');
      if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200)
        throw problem('reason is required, up to 200 characters');
      return { kind: 'single-copy', until, reason };
    }
    default:
      throw problem('Unknown change');
  }
}

/**
 * The text whose SHA-256 is a request's `digest`: the change in its canonical form (the field
 * order of `readSiteChange`) and, when a key goes with it, a line with the key's SHA-256 (hex).
 * The API and the agent hash this same text; the agent refuses a request that does not match,
 * so a change or key swapped in the writable inbox is never applied under another's id.
 */
export function siteChangeDigestText(change: SiteChange, keySha256: string | null): string {
  return JSON.stringify(readSiteChange(change)) + (keySha256 === null ? '' : `\n${keySha256}`);
}

/** The source key of a mirror: printable ASCII without spaces, as `--mirror-token-file` wants. */
export function isSourceKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{16,4000}$/.test(value);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw problem('id is a lowercase UUID');
  return value;
}
function time(value: unknown) {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw problem('Invalid time');
  return result;
}
/** The caller and, through a fleet key, the controller's administrator: 200 characters at most. */
export const SITE_CHANGE_ACTOR_LENGTH = 200;
function actor(value: unknown) {
  const result = text(value);
  if (result.length > SITE_CHANGE_ACTOR_LENGTH) throw problem('Invalid actor');
  return result;
}

const digest = (value: unknown) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw problem('Invalid digest');
  return value;
};

export function readSiteChangeRequest(value: unknown): SiteChangeRequest {
  const row = record(value);
  only(row, ['id', 'digest', 'requestedAt', 'actor', 'change']);
  return {
    id: id(row['id']),
    digest: digest(row['digest']),
    requestedAt: time(row['requestedAt']),
    actor: actor(row['actor']),
    change: readSiteChange(row['change']),
  };
}

const states = ['pending', 'applying', 'done', 'failed'] as const;
/** A code this release does not know reads as a plain failure, not as a broken status. */
function errorCode(value: unknown): SiteChangeError | null {
  if (value === null) return null;
  return siteChangeErrors.find((code) => code === value) ?? 'mirror_failed';
}
function readRecord(value: unknown): SiteChangeRecord {
  const row = record(value);
  const kind = siteChangeKinds.find((item) => item === row['kind']);
  const state = states.find((item) => item === row['state']);
  if (!kind || !state) throw problem('Invalid change record');
  const finished = row['finishedAt'];
  return {
    id: id(row['id']),
    digest: digest(row['digest']),
    kind,
    state,
    error: errorCode(row['error']),
    actor: actor(row['actor']),
    requestedAt: time(row['requestedAt']),
    finishedAt: finished === null ? null : time(finished),
  };
}

export function readSiteChangeStatus(value: unknown): SiteChangeStatus {
  const row = record(value);
  const recent = row['recent'];
  if (!Array.isArray(recent) || recent.length > 20) throw problem('Invalid change list');
  return {
    heartbeatAt: time(row['heartbeatAt']),
    blocked: errorCode(row['blocked'] ?? null),
    recent: recent.map(readRecord),
  };
}

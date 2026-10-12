import type { CatalogFeedEntry } from './catalog-ports.js';
import type { Cancellation } from './ports.js';
import { MirrorFailure } from './mirror-ports.js';
import { applyRegistryChange, isRegistryChange } from './mirror-registry.js';
import type {
  MirrorArtifact,
  MirrorFeedPage,
  MirrorSource,
  MirrorState,
  MirrorStateStore,
  MirrorTarget,
} from './mirror-ports.js';

export interface MirrorSyncDependencies {
  readonly repository: string;
  /** `upstream|sourceRepository`: a state of another source is never continued. */
  readonly source: string;
  readonly upstream: MirrorSource;
  readonly target: MirrorTarget;
  readonly states: MirrorStateStore;
  readonly now: () => string;
}
export type MirrorStep = 'progress' | 'idle';

/** Feed actions of state the mirror does not carry (owner references, build attachments). */
const ignored = new Set(['reference.add', 'reference.remove', 'attachments.replace']);

/** Whether a failure came from the caller stopping the step, not from the source. */
export function stopped(cancellation: Cancellation): boolean {
  try {
    cancellation.throwIfAborted();
    return false;
  } catch {
    return true;
  }
}

/** `upstream|sourceRepository` of a source string; import stages follow after it. */
export function sourceOrigin(source: string): string {
  return source.split('|').slice(0, 2).join('|');
}

/**
 * The stored state for this source. Another source string starts a new seed, which re-reads the
 * source and skips what is here (the copy counters and the last synchronization carry over). A
 * mirror refuses another upstream or source repository (`anyOrigin` false): it already holds a
 * copy of the other one. A mirror detached since holds changes of its own and is never followed
 * again; an import, which only adds, starts over.
 */
export async function stateFor(
  d: Pick<MirrorSyncDependencies, 'repository' | 'source' | 'states'>,
  loaded: MirrorState | null,
  anyOrigin: boolean,
): Promise<MirrorState> {
  if (loaded?.detachedAt != null && !anyOrigin)
    throw new MirrorFailure(
      'mirror_detached',
      'This repository was detached from its mirror and holds changes of its own; mirror the source into a new repository',
    );
  if (loaded?.source === d.source && loaded.detachedAt === null) return loaded;
  if (loaded && !anyOrigin && sourceOrigin(loaded.source) !== sourceOrigin(d.source))
    throw new MirrorFailure(
      'mirror_source_changed',
      'This repository holds a copy of another source; mirror the new source into a new repository',
    );
  const fresh = {
    ...initialMirrorState(d.repository, d.source),
    ...(loaded
      ? {
          copiedArtifacts: loaded.copiedArtifacts,
          copiedBytes: loaded.copiedBytes,
          syncedAt: loaded.syncedAt,
        }
      : {}),
  };
  await d.states.save(fresh);
  return fresh;
}

/**
 * Records a failed step in the stored state, also when the state belongs to another source (its
 * source is kept): the status and the failing gauge must show what stops the mirror.
 */
export async function recordFailure(
  d: Pick<MirrorSyncDependencies, 'repository' | 'states' | 'now'>,
  known: MirrorState | null,
  error: unknown,
): Promise<MirrorState | null> {
  const state = known ?? (await d.states.load(d.repository));
  if (!state) return null;
  const failed = { ...state, errorCode: mirrorErrorCode(error), errorAt: d.now() };
  await d.states.save(failed);
  return failed;
}

/** What names a feed entry besides its sequence, which a restored source hands out again. */
export const feedAnchor = (entry: CatalogFeedEntry) =>
  `${entry.action}|${entry.artifactId}|${entry.detail ?? ''}`;

/**
 * The feed after the cursor, read from the entry at the cursor itself (ADR 0058, 2026-10-12). A
 * source restored from a backup, or replaced by another installation, hands out sequence numbers
 * the mirror has passed; a check of the head alone misses that once new entries passed the
 * cursor. The entry at the cursor tells whether this is still the history the mirror follows:
 * null when it is not, and the caller seeds again.
 */
export async function changesAfter(
  upstream: MirrorSource,
  state: MirrorState,
  cancellation: Cancellation,
): Promise<{
  readonly page: MirrorFeedPage;
  readonly items: readonly CatalogFeedEntry[];
  readonly anchor: string | null;
} | null> {
  if (state.cursor === '0') {
    const page = await upstream.changes('0', cancellation);
    return { page, items: page.items, anchor: null };
  }
  const page = await upstream.changes((BigInt(state.cursor) - 1n).toString(), cancellation);
  const [first, ...items] = page.items;
  if (first?.sequence !== state.cursor) return null;
  const anchor = feedAnchor(first);
  if (state.anchor !== null && state.anchor !== anchor) return null;
  return { page, items, anchor };
}

/**
 * The source was restored or replaced: seed again (the seed re-reads the source and never deletes
 * here) and say why in the status until the mirror has caught up.
 */
export async function reseed(
  d: Pick<MirrorSyncDependencies, 'repository' | 'source' | 'states' | 'now'>,
  state: MirrorState,
): Promise<MirrorState> {
  const reseeded = {
    ...initialMirrorState(d.repository, d.source),
    copiedArtifacts: state.copiedArtifacts,
    copiedBytes: state.copiedBytes,
    syncedAt: state.syncedAt,
    errorCode: 'mirror_source_behind',
    errorAt: d.now(),
  };
  await d.states.save(reseeded);
  return reseeded;
}

/**
 * A seed step that succeeded clears an earlier failure; `mirror_source_behind` stays until the
 * mirror has caught up, because it says why the seed runs.
 */
export const seedProgress = (state: MirrorState): Partial<MirrorState> =>
  state.errorCode === 'mirror_source_behind' ? {} : { errorCode: null, errorAt: null };

const codeOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'code' in value ? value.code : null;
/** Codes of the platform's TLS checks: the source's certificate is not trusted here. */
const CERTIFICATE = /^(CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_(GET_ISSUER|VERIFY)|ERR_TLS_CERT)/;
/** Codes of a connection that failed or broke: the source cannot be reached from here. */
const UNREACHABLE =
  /^(ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_)/;

/**
 * Machine code of a failed step: the failure's own code; a failed connection (the platform's
 * code sits on the error or its cause) as `mirror_unreachable` or, for an untrusted certificate,
 * `mirror_certificate`, so the status says what to fix; else a constant.
 */
export function mirrorErrorCode(error: unknown): string {
  const code = codeOf(error);
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) return code;
  // fetch wraps the platform's error, and a client may wrap fetch's: a short chain of causes.
  let platform: string | undefined;
  let connection = false;
  for (let link = error, depth = 0; link instanceof Error && depth < 4; depth++) {
    const own = codeOf(link);
    if (typeof own === 'string') platform ??= own;
    connection ||= ['ArkvoryNetworkError', 'TimeoutError'].includes(link.name);
    link = link.cause;
  }
  if (platform !== undefined && CERTIFICATE.test(platform)) return 'mirror_certificate';
  if (connection || (platform !== undefined && UNREACHABLE.test(platform)))
    return 'mirror_unreachable';
  return 'mirror_failed';
}

/**
 * Synchronization of one mirrored repository (ADR 0058), one bounded step at a time; the caller
 * loops, sleeps when idle and backs off after a failure. First the seed: remember the feed head,
 * then bring artifacts, packages and asset paths in line with the source page by page; then
 * follow the feed. The registry of container images (ADR 0063) has no listing to seed from, so
 * following starts at the beginning and, up to the seed head, applies registry entries only
 * (`seedHead` marks that replay); after it, every entry. Every applied page or event is saved
 * before the next one, so a restart repeats at most the unsaved unit, and every unit is
 * idempotent: it re-reads the current source state instead of replaying an event payload.
 */
export class MirrorSync {
  private state: MirrorState | null = null;
  constructor(private readonly d: MirrorSyncDependencies) {}

  async step(cancellation: Cancellation): Promise<MirrorStep> {
    try {
      const state = await this.current();
      return state.phase === 'seeding'
        ? await this.seed(state, cancellation)
        : await this.follow(state, cancellation);
    } catch (error) {
      if (!stopped(cancellation)) {
        const known = this.state?.source === this.d.source ? this.state : null;
        this.state = (await recordFailure(this.d, known, error)) ?? this.state;
      }
      throw error;
    }
  }

  private async current(): Promise<MirrorState> {
    if (this.state?.source !== this.d.source)
      this.state = await stateFor(this.d, await this.d.states.load(this.d.repository), false);
    return this.state;
  }

  private async save(change: Partial<MirrorState>): Promise<void> {
    const state = { ...(await this.current()), ...change };
    await this.d.states.save(state);
    this.state = state;
  }

  private async seed(state: MirrorState, cancellation: Cancellation): Promise<MirrorStep> {
    const { upstream, target } = this.d;
    if (state.seedHead === null) {
      // The head first: changes after it are replayed, so none during the seed is lost.
      const { head } = await upstream.changes('0', cancellation);
      await this.save({
        seedHead: head,
        seedStep: 'artifacts',
        seedAfter: null,
        head,
        ...seedProgress(state),
      });
      return 'progress';
    }
    if (state.seedStep === 'artifacts') {
      const page = await upstream.artifacts(state.seedAfter, cancellation);
      for (const artifact of page.items) await this.ensure(artifact, cancellation);
      await this.advance(page.next, 'packages');
    } else if (state.seedStep === 'packages') {
      const page = await upstream.packages(state.seedAfter, cancellation);
      for (const id of page.items)
        if (await this.refresh(id, cancellation)) await target.register(id);
      await this.advance(page.next, 'assets');
    } else {
      const page = await upstream.assets(state.seedAfter, cancellation);
      for (const asset of page.items) await this.syncAsset(asset.path, cancellation);
      if (page.next !== null) await this.save({ seedAfter: page.next, ...seedProgress(state) });
      else
        await this.save({
          phase: 'following',
          cursor: '0',
          anchor: null,
          seedStep: null,
          seedAfter: null,
          ...seedProgress(state),
        });
    }
    return 'progress';
  }

  private async advance(next: string | null, following: 'packages' | 'assets') {
    const progress = seedProgress(await this.current());
    await this.save(
      next === null
        ? { seedStep: following, seedAfter: null, ...progress }
        : { seedAfter: next, ...progress },
    );
  }

  private async follow(state: MirrorState, cancellation: Cancellation): Promise<MirrorStep> {
    const read = await changesAfter(this.d.upstream, state, cancellation);
    if (!read) {
      this.state = await reseed(this.d, state);
      return 'progress';
    }
    const { page, items, anchor } = read;
    await this.save({ head: page.head, checkedAt: this.d.now(), anchor });
    for (const change of items) {
      const replay = state.seedHead !== null && BigInt(change.sequence) <= BigInt(state.seedHead);
      if (!replay || isRegistryChange(change.action)) await this.apply(change, cancellation);
      const at = { cursor: change.sequence, anchor: feedAnchor(change) };
      await this.save(
        replay && change.sequence === state.seedHead ? { ...at, seedHead: null } : at,
      );
    }
    if (page.next !== null) return 'progress';
    // The replay reached the end of the feed: the cursor is at least the seed head, also when
    // no entry below it is left to read.
    const { cursor, seedHead } = await this.current();
    const reached = seedHead !== null && BigInt(cursor) < BigInt(seedHead) ? seedHead : cursor;
    await this.save({
      cursor: reached,
      // An entry not read yet: it is named when the next page starts from it.
      ...(reached === cursor ? {} : { anchor: null }),
      syncedAt: this.d.now(),
      errorCode: null,
      errorAt: null,
      seedHead: null,
    });
    return items.length > 0 ? 'progress' : 'idle';
  }

  private async apply(change: CatalogFeedEntry, cancellation: Cancellation): Promise<void> {
    if (ignored.has(change.action)) return;
    if (isRegistryChange(change.action))
      return applyRegistryChange(change, this.d.target, (id) => this.refresh(id, cancellation));
    if (change.action === 'artifact.delete') return this.d.target.remove(change.artifactId);
    if (change.action === 'asset.replace' || change.action === 'asset.restore') {
      if (change.detail !== null) await this.syncAsset(change.detail, cancellation);
      return;
    }
    // Publication, annotations, stages, promotion and any newer action: re-read the artifact.
    const present = await this.refresh(change.artifactId, cancellation);
    // A promotion into the source repository copies its package registration without a
    // package.register entry: register what was received, as the source holds it registered.
    if (present && (change.action === 'package.register' || change.action === 'artifact.receive'))
      await this.d.target.register(change.artifactId);
  }

  /** Current source state of one artifact; deleted there means deleted here. */
  private async refresh(id: string, cancellation: Cancellation): Promise<boolean> {
    const artifact = await this.d.upstream.artifact(id, cancellation);
    if (!artifact) {
      await this.d.target.remove(id);
      return false;
    }
    return this.ensure(artifact, cancellation);
  }

  private async ensure(artifact: MirrorArtifact, cancellation: Cancellation): Promise<boolean> {
    const { upstream, target } = this.d;
    const copied = await target.copy(artifact, upstream, cancellation);
    if (copied === null) return false;
    if (copied > 0) {
      const state = await this.current();
      await this.save({
        copiedArtifacts: state.copiedArtifacts + 1,
        copiedBytes: (BigInt(state.copiedBytes) + BigInt(copied)).toString(),
      });
    }
    const annotation = await upstream.annotation(artifact.id, cancellation);
    if (!annotation) {
      await target.remove(artifact.id);
      return false;
    }
    await target.annotate(artifact.id, annotation);
    await target.stages(artifact.id, await upstream.stages(artifact.id, cancellation));
    return true;
  }

  private async syncAsset(path: string, cancellation: Cancellation): Promise<void> {
    const asset = await this.d.upstream.asset(path, cancellation);
    if (asset && (await this.refresh(asset.artifactId, cancellation)))
      await this.d.target.asset(asset);
  }
}

export function initialMirrorState(repository: string, source: string): MirrorState {
  return {
    repository,
    source,
    phase: 'seeding',
    seedStep: null,
    seedAfter: null,
    seedHead: null,
    cursor: '0',
    head: null,
    checkedAt: null,
    syncedAt: null,
    errorCode: null,
    errorAt: null,
    copiedArtifacts: 0,
    copiedBytes: '0',
    anchor: null,
    detachedAt: null,
  };
}

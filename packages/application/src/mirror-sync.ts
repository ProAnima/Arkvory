import type { CatalogFeedEntry } from './catalog-ports.js';
import type { Cancellation } from './ports.js';
import { MirrorFailure } from './mirror-ports.js';
import { applyRegistryChange, isRegistryChange } from './mirror-registry.js';
import type {
  MirrorArtifact,
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
 * source and skips what is here (the copy counters carry over). A mirror refuses another
 * upstream or source repository (`anyOrigin` false): it already holds a copy of the other one.
 */
export async function stateFor(
  d: Pick<MirrorSyncDependencies, 'repository' | 'source' | 'states'>,
  loaded: MirrorState | null,
  anyOrigin: boolean,
): Promise<MirrorState> {
  if (loaded?.source === d.source) return loaded;
  if (loaded && !anyOrigin && sourceOrigin(loaded.source) !== sourceOrigin(d.source))
    throw new MirrorFailure(
      'mirror_source_changed',
      'This repository holds a copy of another source; mirror the new source into a new repository',
    );
  const fresh = {
    ...initialMirrorState(d.repository, d.source),
    ...(loaded ? { copiedArtifacts: loaded.copiedArtifacts, copiedBytes: loaded.copiedBytes } : {}),
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

/**
 * A source whose feed head is below the applied cursor was restored or reinstalled: its newer
 * events would reuse sequences the mirror has passed. Seed again (the seed re-reads the source
 * and never deletes here) and say why in the status until the mirror has caught up.
 */
export async function reseedBehind(
  d: Pick<MirrorSyncDependencies, 'repository' | 'source' | 'states' | 'now'>,
  state: MirrorState,
  head: string,
): Promise<MirrorState | null> {
  if (BigInt(head) >= BigInt(state.cursor)) return null;
  const reseeded = {
    ...initialMirrorState(d.repository, d.source),
    copiedArtifacts: state.copiedArtifacts,
    copiedBytes: state.copiedBytes,
    errorCode: 'mirror_source_behind',
    errorAt: d.now(),
  };
  await d.states.save(reseeded);
  return reseeded;
}

/** Machine code of a failed step: the failure's own code, else a constant. */
export function mirrorErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'mirror_failed';
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
      await this.save({ seedHead: head, seedStep: 'artifacts', seedAfter: null, head });
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
      if (page.next !== null) await this.save({ seedAfter: page.next });
      else await this.save({ phase: 'following', cursor: '0', seedStep: null, seedAfter: null });
    }
    return 'progress';
  }

  private async advance(next: string | null, following: 'packages' | 'assets') {
    await this.save(next === null ? { seedStep: following, seedAfter: null } : { seedAfter: next });
  }

  private async follow(state: MirrorState, cancellation: Cancellation): Promise<MirrorStep> {
    const page = await this.d.upstream.changes(state.cursor, cancellation);
    const reseeded = await reseedBehind(this.d, state, page.head);
    if (reseeded) {
      this.state = reseeded;
      return 'progress';
    }
    await this.save({ head: page.head, checkedAt: this.d.now() });
    for (const change of page.items) {
      const replay = state.seedHead !== null && BigInt(change.sequence) <= BigInt(state.seedHead);
      if (!replay || isRegistryChange(change.action)) await this.apply(change, cancellation);
      await this.save(
        replay && change.sequence === state.seedHead
          ? { cursor: change.sequence, seedHead: null }
          : { cursor: change.sequence },
      );
    }
    if (page.next !== null) return 'progress';
    // The replay reached the end of the feed: the cursor is at least the seed head, also when
    // no entry below it is left to read.
    const { cursor, seedHead } = await this.current();
    const reached = seedHead !== null && BigInt(cursor) < BigInt(seedHead) ? seedHead : cursor;
    await this.save({
      cursor: reached,
      syncedAt: this.d.now(),
      errorCode: null,
      errorAt: null,
      seedHead: null,
    });
    return page.items.length > 0 ? 'progress' : 'idle';
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
    if (present && change.action === 'package.register')
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
  };
}

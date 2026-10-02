import type { CatalogFeedEntry } from './catalog-ports.js';
import type { Cancellation } from './ports.js';
import { MirrorFailure } from './mirror-ports.js';
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

function stopped(cancellation: Cancellation): boolean {
  try {
    cancellation.throwIfAborted();
    return false;
  } catch {
    return true;
  }
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
 * follow the feed from that head. Every applied page or event is saved before the next one, so
 * a restart repeats at most the unsaved unit, and every unit is idempotent: it re-reads the
 * current source state instead of replaying an event payload.
 */
export class MirrorSync {
  private state: MirrorState | null = null;
  constructor(private readonly d: MirrorSyncDependencies) {}

  async step(cancellation: Cancellation): Promise<MirrorStep> {
    const state = await this.current();
    try {
      return state.phase === 'seeding'
        ? await this.seed(state, cancellation)
        : await this.follow(state, cancellation);
    } catch (error) {
      if (!stopped(cancellation))
        await this.save({ errorCode: mirrorErrorCode(error), errorAt: this.d.now() });
      throw error;
    }
  }

  private async current(): Promise<MirrorState> {
    this.state ??= await this.d.states.load(this.d.repository);
    if (!this.state) {
      this.state = initialState(this.d.repository, this.d.source);
      await this.d.states.save(this.state);
    }
    if (this.state.source !== this.d.source)
      throw new MirrorFailure(
        'mirror_source_changed',
        'The repository mirrors another source; detach it before changing the source',
      );
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
      else
        await this.save({
          phase: 'following',
          cursor: state.seedHead,
          seedStep: null,
          seedAfter: null,
          seedHead: null,
        });
    }
    return 'progress';
  }

  private async advance(next: string | null, following: 'packages' | 'assets') {
    await this.save(next === null ? { seedStep: following, seedAfter: null } : { seedAfter: next });
  }

  private async follow(state: MirrorState, cancellation: Cancellation): Promise<MirrorStep> {
    const page = await this.d.upstream.changes(state.cursor, cancellation);
    await this.save({ head: page.head, checkedAt: this.d.now() });
    for (const change of page.items) {
      await this.apply(change, cancellation);
      await this.save({ cursor: change.sequence });
    }
    if (page.next !== null) return 'progress';
    await this.save({ syncedAt: this.d.now(), errorCode: null, errorAt: null });
    return page.items.length > 0 ? 'progress' : 'idle';
  }

  private async apply(change: CatalogFeedEntry, cancellation: Cancellation): Promise<void> {
    if (ignored.has(change.action)) return;
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

function initialState(repository: string, source: string): MirrorState {
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

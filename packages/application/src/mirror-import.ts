import type { MirrorState } from './mirror-ports.js';
import {
  changesAfter,
  feedAnchor,
  recordFailure,
  reseed,
  seedProgress,
  stateFor,
  stopped,
} from './mirror-sync.js';
import type { MirrorStep, MirrorSyncDependencies } from './mirror-sync.js';
import type { Cancellation } from './ports.js';

export interface StageImportDependencies extends MirrorSyncDependencies {
  /** Stages that bring a version over, e.g. ["release"]. */
  readonly stages: readonly string[];
}

/**
 * Import mode of a mirror (ADR 0058): a version of the source is taken over once, when it carries
 * one of the configured stages, with the same ID, bytes, annotations, UPack registration and the
 * matching stages. Afterwards the copy belongs to this installation: changes, stage removal and
 * deletion on the source do not reach it, and a copy deleted here is never imported again.
 * The seed walks the staged artifacts after remembering the feed head; then only `stage.add`
 * events of a configured stage matter. Every event is saved before the next one.
 */
export class StageImport {
  private state: MirrorState | null = null;
  constructor(private readonly d: StageImportDependencies) {}

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

  /**
   * Another source, other stages or a former mirror: seed again. Importing never deletes and
   * skips what is here already, so a new seed only brings what the new filter selects.
   */
  private async current(): Promise<MirrorState> {
    if (this.state?.source !== this.d.source)
      this.state = await stateFor(this.d, await this.d.states.load(this.d.repository), true);
    return this.state;
  }

  private async save(change: Partial<MirrorState>): Promise<void> {
    const state = { ...(await this.current()), ...change };
    await this.d.states.save(state);
    this.state = state;
  }

  /** `seedAfter` is "<stage index>|<page cursor>": one listing per configured stage. */
  private async seed(state: MirrorState, cancellation: Cancellation): Promise<MirrorStep> {
    if (state.seedHead === null) {
      const { head } = await this.d.upstream.changes('0', cancellation);
      await this.save({ seedHead: head, seedStep: 'artifacts', seedAfter: '0|', head });
      return 'progress';
    }
    const [index = '0', after = ''] = (state.seedAfter ?? '0|').split('|');
    const stage = this.d.stages[Number(index)];
    if (stage === undefined) {
      await this.save({
        phase: 'following',
        cursor: state.seedHead,
        anchor: null,
        seedStep: null,
        seedAfter: null,
        seedHead: null,
      });
      return 'progress';
    }
    const page = await this.d.upstream.staged(stage, after === '' ? null : after, cancellation);
    for (const id of page.items) await this.take(id, null, cancellation);
    await this.save({
      seedAfter: page.next === null ? `${String(Number(index) + 1)}|` : `${index}|${page.next}`,
      ...seedProgress(state),
    });
    return 'progress';
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
      const stage = change.action === 'stage.add' ? change.detail : null;
      if (stage !== null && this.d.stages.includes(stage))
        await this.take(change.artifactId, stage, cancellation);
      await this.save({ cursor: change.sequence, anchor: feedAnchor(change) });
    }
    if (page.next !== null) return 'progress';
    await this.save({ syncedAt: this.d.now(), errorCode: null, errorAt: null });
    return items.length > 0 ? 'progress' : 'idle';
  }

  /**
   * Takes one version over; a copy deleted here stays deleted. A version settled here (taken over
   * before, or made here and back from the other side of a two-way import) keeps its own stages
   * and annotations: a seed passes it, and a promotion on the source adds only the stage it names
   * (`promoted`). A copy whose completion a crash interrupted is completed (adopt is repeatable).
   */
  private async take(
    id: string,
    promoted: string | null,
    cancellation: Cancellation,
  ): Promise<void> {
    const { upstream, target } = this.d;
    const local = await target.local(id);
    if (local === 'deleted') return;
    const settled = local === 'present' && (await target.settled(id));
    if (settled && promoted === null) return;
    const artifact = await upstream.artifact(id, cancellation);
    if (!artifact) return;
    const stages = (await upstream.stages(id, cancellation)).filter((entry) =>
      this.d.stages.includes(entry.stage),
    );
    if (settled) {
      // Only a stage the source still carries: removed again before this ran, it was withdrawn.
      await target.addStages(
        id,
        stages.filter((entry) => entry.stage === promoted),
      );
      return;
    }
    // The stage was removed before this import ran: the version was not promoted after all.
    if (stages.length === 0) return;
    const copied = local === 'present' ? 0 : await target.copy(artifact, upstream, cancellation);
    // Deleted here meanwhile: the deletion stands, as in a mirror.
    if (copied === null) return;
    await target.adopt(id, await upstream.annotation(id, cancellation), stages);
    if (copied > 0) {
      const state = await this.current();
      await this.save({
        copiedArtifacts: state.copiedArtifacts + 1,
        copiedBytes: (BigInt(state.copiedBytes) + BigInt(copied)).toString(),
      });
    }
  }
}

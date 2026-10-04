import type { MirrorState } from './mirror-ports.js';
import { recordFailure, reseedBehind, stateFor, stopped } from './mirror-sync.js';
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
        seedStep: null,
        seedAfter: null,
        seedHead: null,
      });
      return 'progress';
    }
    const page = await this.d.upstream.staged(stage, after === '' ? null : after, cancellation);
    for (const id of page.items) await this.take(id, cancellation);
    await this.save({
      seedAfter: page.next === null ? `${String(Number(index) + 1)}|` : `${index}|${page.next}`,
    });
    return 'progress';
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
      const wanted =
        change.action === 'stage.add' &&
        change.detail !== null &&
        this.d.stages.includes(change.detail);
      if (wanted) await this.take(change.artifactId, cancellation);
      await this.save({ cursor: change.sequence });
    }
    if (page.next !== null) return 'progress';
    await this.save({ syncedAt: this.d.now(), errorCode: null, errorAt: null });
    return page.items.length > 0 ? 'progress' : 'idle';
  }

  /**
   * Takes one version over; a copy deleted here stays deleted. A version already here is only
   * completed (adopt is repeatable), so a crash between the bytes and the stages heals itself.
   */
  private async take(id: string, cancellation: Cancellation): Promise<void> {
    const { upstream, target } = this.d;
    const local = await target.local(id);
    if (local === 'deleted') return;
    const artifact = await upstream.artifact(id, cancellation);
    if (!artifact) return;
    const stages = (await upstream.stages(id, cancellation)).filter((entry) =>
      this.d.stages.includes(entry.stage),
    );
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

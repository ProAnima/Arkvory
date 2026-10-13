import { MirrorFailure } from '@proanima/arkvory-application';
import type {
  ArtifactCatalog,
  ArtifactPromotion,
  MirrorAdoptionStore,
  MirrorAnnotation,
  MirrorStage,
} from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';

export const idTaken = (id: string, repository: string) =>
  new MirrorFailure(
    'mirror_id_taken',
    `Artifact ${id} of the source is held by repository ${repository} here; one source repository can fill one repository`,
  );

/**
 * What a synchronization decides about versions besides copying them (ADR 0058): their UPack
 * registration, and in import mode their stages, their annotations and the record that a version
 * was taken over. A version taken over (or made here) is settled: later imports add only stages
 * the source newly gives it and never change what was decided here.
 */
export class MirrorAdoption {
  constructor(
    private readonly repository: string,
    private readonly store: MirrorAdoptionStore,
    private readonly principal: Principal,
    private readonly browse: ArtifactCatalog,
    private readonly promotion: ArtifactPromotion,
  ) {}

  async register(id: string): Promise<void> {
    try {
      await this.browse.register(this.principal, this.repository, id);
    } catch (error) {
      if (!(error instanceof ArkvoryError)) throw error;
      // Bytes that are no UPack have no package to register.
      if (error.code === 'invalid_input') return;
      if (error.reason === 'version_exists')
        throw new MirrorFailure(
          'mirror_package_conflict',
          `Artifact ${id} has a package version this repository holds with other bytes; clients asking for it would get the other ones`,
        );
      throw error;
    }
  }

  async addStages(id: string, stages: readonly MirrorStage[]): Promise<void> {
    if (stages.length === 0) return;
    const current = await this.promotion.stages(this.principal, this.repository, id);
    for (const { stage, comment } of stages)
      if (!current.some((entry) => entry.stage === stage))
        await this.promotion.setStage(this.principal, this.repository, id, stage, comment);
  }

  /** Completes a copy, then records it as taken over: all of it repeats after a crash. */
  async adopt(
    id: string,
    annotation: MirrorAnnotation | null,
    stages: readonly MirrorStage[],
  ): Promise<void> {
    if (annotation) {
      // Revision 0: nobody here has edited the annotations yet, so the source's apply.
      const current = await this.browse.annotation(this.principal, this.repository, id);
      if (current.revision === 0)
        await this.browse.annotate(this.principal, this.repository, id, 0, annotation);
    }
    await this.register(id);
    await this.addStages(id, stages);
    await this.store.record(this.repository, id);
  }

  /** Taken over by an earlier import, or made here (not uploaded by the synchronization). */
  async settled(id: string): Promise<boolean> {
    return this.store.settled(this.repository, id, this.principal.id);
  }

  /**
   * An ID the synchronization did not upload. Two installations that import from each other
   * share IDs: a version made here comes back from the other side under its own ID. Published
   * here, it is present; deleted here or unfinished by someone else, it is never taken over and
   * never created a second time. Held by another repository, it is a failure that says so.
   */
  /** Who holds an ID here, for a copy that finds no upload of its own. */
  holder(id: string) {
    return this.store.holder(id);
  }

  async foreign(id: string): Promise<'absent' | 'present' | 'deleted'> {
    const holder = await this.store.holder(id);
    if (!holder) return 'absent';
    if (holder.repository !== this.repository) throw idTaken(id, holder.repository);
    return holder.status === 'available' ? 'present' : 'deleted';
  }
}

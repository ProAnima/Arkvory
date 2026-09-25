import {
  authorizeAction,
  requireId,
  retentionObject,
  parseRetentionCriteria,
  parseDeletionSelection,
  annotationRevision,
  DepotError,
} from '@proanima/depot-domain';
import type {
  Principal,
  MutationAccess,
  RetentionCriteria,
  DeletionSelection,
} from '@proanima/depot-domain';

export type DeletionBlocker =
  'reference' | 'asset_history' | 'attachment_history' | 'protected_label';
export interface DeletionCandidate {
  id: string;
  name: string;
  size: string;
  publishedAt: string;
  annotationRevision: number;
  blockers: readonly DeletionBlocker[];
}
export interface RetentionPreview {
  items: readonly DeletionCandidate[];
  next: string | null;
}
export interface DeletionResult {
  id: string;
  outcome: 'deleted' | 'already_deleted' | 'protected' | 'changed' | 'not_eligible' | 'not_found';
  blockers: readonly DeletionBlocker[];
}
export interface RetentionStore {
  inspect(repository: string, id: string): Promise<DeletionCandidate>;
  preview(
    repository: string,
    criteria: RetentionCriteria,
    limit: number,
    after?: string,
  ): Promise<RetentionPreview>;
  remove(
    access: MutationAccess,
    selected: readonly DeletionSelection[],
    criteria?: RetentionCriteria,
  ): Promise<readonly DeletionResult[]>;
}
export class ArtifactRetention {
  constructor(
    private readonly store: RetentionStore,
    private readonly now: () => string,
  ) {}
  private access(principal: Principal, repository: string): MutationAccess {
    authorizeAction(principal, repository, 'artifact.delete', null);
    return { principal, repository, actions: ['artifact.delete'] };
  }
  inspect(principal: Principal, repository: string, id: string) {
    this.access(principal, repository);
    return this.store.inspect(repository, requireId(id));
  }
  preview(principal: Principal, repository: string, value: unknown) {
    this.access(principal, repository);
    const row = retentionObject(value, ['criteria', 'limit', 'after']);
    const criteria = parseRetentionCriteria(row['criteria'], this.now());
    const limit = row['limit'] ?? 50;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new DepotError('invalid_input', 'Page limit must be between 1 and 100');
    const after = row['after'];
    if (after !== undefined && typeof after !== 'string')
      throw new DepotError('invalid_input', 'Invalid cursor');
    return this.store.preview(
      repository,
      criteria,
      limit,
      after === undefined ? undefined : requireId(after),
    );
  }
  async remove(principal: Principal, repository: string, id: string, value: unknown) {
    const access = this.access(principal, repository);
    const row = retentionObject(value, ['expectedAnnotationRevision']);
    const results = await this.store.remove(access, [
      {
        id: requireId(id),
        expectedAnnotationRevision: annotationRevision(row['expectedAnnotationRevision']),
      },
    ]);
    const result = results[0];
    if (!result) throw new DepotError('unavailable', 'Missing deletion result');
    return result;
  }
  async apply(principal: Principal, repository: string, value: unknown) {
    const access = this.access(principal, repository);
    const row = retentionObject(value, ['criteria', 'items']);
    const criteria = parseRetentionCriteria(row['criteria'], this.now());
    return {
      items: await this.store.remove(access, parseDeletionSelection(row['items']), criteria),
    };
  }
}

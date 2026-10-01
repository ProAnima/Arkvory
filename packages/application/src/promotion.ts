import {
  authorizeAction,
  ArkvoryError,
  parsePromotionRequest,
  requireComment,
  requireId,
  requireStage,
  withField,
} from '@proanima/arkvory-domain';
import type { MutationAccess, Principal, PromotionMode } from '@proanima/arkvory-domain';
import type { StorageService } from './storage.js';
import type { IdentitySource } from './ports.js';

export interface StageEntry {
  readonly artifactId: string;
  readonly stage: string;
  readonly promotedAt: string;
  readonly actor: string;
  readonly comment: string | null;
}
export type PromotionAction = 'stage.added' | 'stage.removed' | 'promoted' | 'received';
export interface PromotionEvent {
  readonly sequence: string;
  readonly repository: string;
  readonly artifactId: string;
  readonly action: PromotionAction;
  readonly stage: string | null;
  readonly mode: PromotionMode | null;
  readonly peerRepository: string | null;
  readonly peerArtifactId: string | null;
  readonly actor: string;
  readonly comment: string | null;
  readonly occurredAt: string;
}
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
export interface PromotionResult {
  readonly repository: string;
  readonly artifactId: string;
  readonly sourceRepository: string;
  readonly sourceArtifactId: string;
  readonly mode: PromotionMode;
  /** False when an earlier promotion of the same source already published this copy. */
  readonly created: boolean;
  readonly stages: readonly string[];
}
export interface PromotionInput {
  readonly source: MutationAccess;
  readonly target: MutationAccess;
  readonly id: string;
  readonly copyId: string;
  readonly now: string;
  readonly mode: PromotionMode;
  readonly stages: readonly string[];
  readonly comment: string | null;
}

/** Stage state and history; every mutation records its event in the same transaction. */
export interface StageStore {
  stages(repository: string, id: string): Promise<readonly StageEntry[]>;
  stagedArtifacts(
    repository: string,
    stage: string | undefined,
    after: string | undefined,
    limit: number,
    ids?: readonly string[],
  ): Promise<Page<StageEntry>>;
  setStage(
    access: MutationAccess,
    id: string,
    stage: string,
    comment: string | null,
  ): Promise<StageEntry>;
  removeStage(access: MutationAccess, id: string, stage: string): Promise<boolean>;
  events(
    repository: string,
    id: string | undefined,
    after: string | undefined,
    limit: number,
  ): Promise<Page<PromotionEvent>>;
}
/** Publishes the copy and, for move, retires the source atomically after linking the bytes. */
export interface PromotionStore {
  promote(input: PromotionInput): Promise<PromotionResult>;
}

const cursor = (value: string | undefined) => {
  if (value !== undefined && !/^[0-9]{1,18}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Invalid promotion cursor');
  return value;
};
const stageCursor = (value: string) => {
  const [id = '', stage = ''] = value.split('/');
  requireId(id);
  requireStage(stage);
  return value;
};
const pageSize = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new ArkvoryError('invalid_input', 'Invalid page size');
  return value;
};

export class ArtifactPromotion {
  constructor(
    private readonly storage: Pick<StorageService, 'artifact'>,
    private readonly stageStore: StageStore,
    private readonly promotions: PromotionStore,
    private readonly identity: IdentitySource,
  ) {}

  async stages(p: Principal, repository: string, id: string) {
    await this.storage.artifact(p, repository, id);
    return this.stageStore.stages(repository, id);
  }

  stagedArtifacts(
    p: Principal,
    repository: string,
    filter: { stage?: string; after?: string; limit?: number; ids?: readonly string[] } = {},
  ) {
    authorizeAction(p, repository, 'artifact.list', ['read']);
    const stage = filter.stage === undefined ? undefined : requireStage(filter.stage);
    const start = filter.after === undefined ? undefined : stageCursor(filter.after);
    const ids = filter.ids?.map(requireId);
    if (ids && (ids.length === 0 || ids.length > 100))
      throw new ArkvoryError('invalid_input', 'Between 1 and 100 artifact ids allowed');
    return this.stageStore.stagedArtifacts(
      repository,
      stage,
      start,
      pageSize(filter.limit ?? 100),
      ids,
    );
  }

  async setStage(p: Principal, repository: string, id: string, stage: string, comment: unknown) {
    authorizeAction(p, repository, 'artifact.promote', ['read', 'write']);
    await this.storage.artifact(p, repository, id);
    return this.stageStore.setStage(
      access(p, repository),
      id,
      withField('stage', () => requireStage(stage)),
      withField('/comment', () => requireComment(comment)),
    );
  }

  async removeStage(p: Principal, repository: string, id: string, stage: string) {
    authorizeAction(p, repository, 'artifact.promote', ['read', 'write']);
    await this.storage.artifact(p, repository, id);
    return this.stageStore.removeStage(access(p, repository), id, requireStage(stage));
  }

  async history(p: Principal, repository: string, id: string, after?: string, limit = 50) {
    await this.storage.artifact(p, repository, id);
    return this.stageStore.events(repository, id, cursor(after), pageSize(limit));
  }

  repositoryEvents(p: Principal, repository: string, after?: string, limit = 50) {
    authorizeAction(p, repository, 'artifact.list', ['read']);
    return this.stageStore.events(repository, undefined, cursor(after), pageSize(limit));
  }

  async promote(p: Principal, source: string, id: string, value: unknown) {
    const request = parsePromotionRequest(value);
    if (request.target === source)
      throw new ArkvoryError('invalid_input', 'Promotion target must differ from the source');
    // Source bytes are copied by reference, so reading them is the minimum source authority.
    await this.storage.artifact(p, source, id, 'content.read');
    authorizeAction(p, source, 'artifact.read', ['read']);
    if (request.mode === 'move') authorizeAction(p, source, 'artifact.promote', ['read', 'write']);
    authorizeAction(p, request.target, 'artifact.promote', ['read', 'write']);
    return this.promotions.promote({
      source: {
        principal: p,
        repository: source,
        actions:
          request.mode === 'move'
            ? ['artifact.read', 'content.read', 'artifact.promote']
            : ['artifact.read', 'content.read'],
      },
      target: access(p, request.target),
      id,
      copyId: this.identity.next(),
      now: this.identity.now(),
      mode: request.mode,
      stages: request.stages,
      comment: request.comment,
    });
  }
}

function access(principal: Principal, repository: string): MutationAccess {
  return { principal, repository, actions: ['artifact.promote'] };
}

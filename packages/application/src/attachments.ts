import { authorizeAction, ArkvoryError, parseAttachments } from '@proanima/arkvory-domain';
import type { BuildAttachment, MutationAccess, Principal } from '@proanima/arkvory-domain';
import type { StorageService } from './storage.js';

export interface AttachmentRevision {
  revision: number;
  items: readonly BuildAttachment[];
  actor: string | null;
  createdAt: string | null;
}
export interface AttachmentHistory {
  items: readonly AttachmentRevision[];
  next: number | null;
}
export interface AttachmentStore {
  get(repository: string, id: string): Promise<AttachmentRevision>;
  history(repository: string, id: string, before?: number): Promise<AttachmentHistory>;
  replace(
    repository: string,
    id: string,
    expected: number,
    items: readonly BuildAttachment[],
    access: MutationAccess,
  ): Promise<AttachmentRevision>;
}
export class BuildAttachments {
  constructor(
    private readonly storage: Pick<StorageService, 'artifact'>,
    private readonly store: AttachmentStore,
  ) {}
  async get(p: Principal, repository: string, id: string) {
    await this.storage.artifact(p, repository, id, 'annotation.read');
    return this.store.get(repository, id);
  }
  async history(p: Principal, repository: string, id: string, before?: number) {
    await this.storage.artifact(p, repository, id, 'annotation.read');
    if (
      before !== undefined &&
      (!Number.isSafeInteger(before) || before < 1 || before > 2147483647)
    )
      throw new ArkvoryError('invalid_input', 'Invalid attachment history cursor');
    return this.store.history(repository, id, before);
  }
  async replace(p: Principal, repository: string, id: string, expected: number, value: unknown) {
    authorizeAction(p, repository, 'annotation.write', ['write']);
    await this.storage.artifact(p, repository, id);
    if (!Number.isSafeInteger(expected) || expected < 0 || expected > 2147483646)
      throw new ArkvoryError('invalid_input', 'Invalid attachment revision');
    const items = parseAttachments(value, id);
    return this.store.replace(repository, id, expected, items, {
      principal: p,
      repository,
      actions: ['annotation.write', 'artifact.read'],
    });
  }
}

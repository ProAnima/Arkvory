import {
  ArkvoryError,
  LfsError,
  authorizeAction,
  isLfsOid,
  lfsRef,
  parseLfsBatch,
  requireLockPath,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type { StorageService } from './storage.js';

export interface LfsLock {
  readonly id: string;
  readonly path: string;
  readonly lockedAt: string;
  readonly ownerId: string;
  /** The account's name (user or service account), else the key's ID. */
  readonly ownerName: string;
}
/** Object rows over artifacts (ADR 0065); every change is journaled in the repository feed. */
export interface LfsIndex {
  object(repository: string, oid: string): Promise<string | null>;
  /** Points the oid at the artifact that now holds it, replacing a vanished one. */
  addObject(actor: Principal, repository: string, oid: string, artifactId: string): Promise<void>;
}
export interface LfsLocks {
  /** The new lock, or the one that holds the path already. */
  create(lock: {
    readonly id: string;
    readonly repository: string;
    readonly path: string;
    readonly ownerId: string;
  }): Promise<{ readonly created: boolean; readonly lock: LfsLock }>;
  list(
    repository: string,
    filter: { readonly path?: string; readonly id?: string },
    after: string | null,
    limit: number,
  ): Promise<{ readonly locks: readonly LfsLock[]; readonly next: string | null }>;
  remove(repository: string, id: string): Promise<LfsLock | null>;
  get(repository: string, id: string): Promise<LfsLock | null>;
}
export interface LfsObjectState {
  readonly oid: string;
  readonly size: number;
  /** Already stored (upload: nothing to send) or available (download: can be fetched). */
  readonly present: boolean;
}

type Storage = Pick<StorageService, 'artifact' | 'create' | 'upload' | 'maxObjectBytes'>;
const absent = (error: unknown) => error instanceof ArkvoryError && error.code === 'not_found';
const lockPage = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 100
    ? value
    : 100;

/**
 * Git LFS over artifacts (ADR 0065): objects are artifacts named by their SHA-256 oid, which
 * the artifact store verifies; locks are rows of the repository. Download needs content.read,
 * upload the upload actions, locking write access; another owner's lock is broken only with
 * artifact.delete. A read-only mirror refuses uploads and locks like any change.
 */
export class GitLfs {
  constructor(
    private readonly storage: Storage,
    private readonly index: LfsIndex,
    private readonly locks: LfsLocks,
    private readonly ids: { next(): string },
  ) {}

  async batch(principal: Principal, repository: string, body: unknown) {
    const request = parseLfsBatch(body, this.storage.maxObjectBytes);
    if (request.operation === 'download')
      authorizeAction(principal, repository, 'content.read', ['read']);
    else authorizeAction(principal, repository, 'upload.create', ['write']);
    const objects: LfsObjectState[] = [];
    for (const { oid, size } of request.objects) {
      const stored = await this.stored(principal, repository, oid);
      objects.push({ oid, size, present: stored !== null && stored.size === size });
    }
    return { operation: request.operation, objects };
  }

  /** The artifact of an object to download; unknown also when it is gone or another size. */
  async object(principal: Principal, repository: string, oid: string): Promise<string> {
    authorizeAction(principal, repository, 'content.read', ['read']);
    if (!isLfsOid(oid)) throw new LfsError(404, 'Object does not exist');
    const stored = await this.stored(principal, repository, oid);
    if (!stored) throw new LfsError(404, 'Object does not exist');
    return stored.artifactId;
  }

  /**
   * Stores one object of the basic transfer. The artifact store checks size and SHA-256 against
   * the oid while it writes. An object stored already is not sent again (`consumed` false); a
   * retried upload of the same owner finds its artifact by the oid's idempotency key.
   */
  async upload(
    principal: Principal,
    repository: string,
    object: { readonly oid: string; readonly size: number },
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<{ readonly consumed: boolean }> {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    if (!isLfsOid(object.oid)) throw new LfsError(422, 'Invalid oid');
    const stored = await this.stored(principal, repository, object.oid);
    if (stored && stored.size === object.size) return { consumed: false };
    const created = await this.storage.create(principal, repository, `lfs-${object.oid}`, {
      name: object.oid,
      size: String(object.size),
      sha256: object.oid,
      labels: ['lfs'],
      metadata: {},
    });
    if (created.status === 'cancelled')
      throw new LfsError(409, 'This object was stored and deleted; it cannot be uploaded again');
    if (created.status === 'pending')
      await this.storage.upload(principal, repository, created.id, source, cancellation);
    await this.index.addObject(principal, repository, object.oid, created.id);
    return { consumed: created.status === 'pending' };
  }

  async lock(principal: Principal, repository: string, body: unknown) {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const fields = record(body);
    const path = requireLockPath(fields['path']);
    lfsRef(fields['ref']);
    return this.locks.create({ id: this.ids.next(), repository, path, ownerId: principal.id });
  }

  async listLocks(principal: Principal, repository: string, query: Record<string, unknown>) {
    authorizeAction(principal, repository, 'artifact.list', ['read']);
    const path = typeof query['path'] === 'string' ? requireLockPath(query['path']) : undefined;
    const id = typeof query['id'] === 'string' ? query['id'] : undefined;
    const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : null;
    const limit = lockPage(Number(query['limit'] ?? 100));
    return this.locks.list(
      repository,
      { ...(path ? { path } : {}), ...(id ? { id } : {}) },
      cursor,
      limit,
    );
  }

  /** The caller's locks and everyone else's, as git-lfs checks them before a push. */
  async verifyLocks(principal: Principal, repository: string, body: unknown) {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const fields = record(body);
    lfsRef(fields['ref']);
    const cursor = typeof fields['cursor'] === 'string' ? fields['cursor'] : null;
    const page = await this.locks.list(repository, {}, cursor, lockPage(fields['limit']));
    return {
      ours: page.locks.filter((lock) => lock.ownerId === principal.id),
      theirs: page.locks.filter((lock) => lock.ownerId !== principal.id),
      next: page.next,
    };
  }

  /** Own locks need write access; `force` on another owner's lock needs artifact.delete. */
  async unlock(principal: Principal, repository: string, id: string, body: unknown) {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const force = record(body)['force'] === true;
    const lock = await this.locks.get(repository, id);
    if (!lock) throw new LfsError(404, 'Lock does not exist');
    if (lock.ownerId !== principal.id) {
      if (!force) throw new ArkvoryError('forbidden', 'The lock belongs to another owner');
      authorizeAction(principal, repository, 'artifact.delete', null);
    }
    const removed = await this.locks.remove(repository, id);
    if (!removed) throw new LfsError(404, 'Lock does not exist');
    return removed;
  }

  private async stored(principal: Principal, repository: string, oid: string) {
    const artifactId = await this.index.object(repository, oid);
    if (!artifactId) return null;
    try {
      const upload = await this.storage.artifact(principal, repository, artifactId, 'content.read');
      return { artifactId, size: upload.descriptor.size };
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new LfsError(422, 'Expected a JSON object');
  return Object.fromEntries(Object.entries(value));
}

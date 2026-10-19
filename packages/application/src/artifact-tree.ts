import {
  ArkvoryError,
  TREE_MAX_ENTRIES,
  TREE_PAGE_LIMIT,
  treeIndexable,
} from '@proanima/arkvory-domain';
import type { ArchiveTree, ArchiveTreeEntry, Principal } from '@proanima/arkvory-domain';
import type { StorageService } from './storage.js';
import type { Cancellation } from './ports.js';

/** The stored outcome of indexing one archive; absent while the worker has not indexed it. */
export interface TreeIndexState {
  readonly status: 'ready' | 'unavailable';
  /** Machine reason of `unavailable`; a later release may store reasons this one does not know. */
  readonly reason: string | null;
  /** File entries of a `ready` table. */
  readonly entries: number | null;
}

export interface TreeIndexRead {
  state(uploadId: string): Promise<TreeIndexState | undefined>;
  /** File entries with an ordinal above `after`, in ordinal order, at most `limit`. */
  entries(uploadId: string, after: number, limit: number): Promise<readonly ArchiveTreeEntry[]>;
}

/** One page of the table of contents of an archive artifact (ADR 0083, N8). */
export interface ArtifactTreeView {
  readonly status: 'ready' | 'pending' | 'unavailable';
  readonly reason: string | null;
  /** The artifact's own descriptor SHA-256: the archive the table describes. */
  readonly archiveSha256: string;
  readonly entries: number | null;
  readonly items: readonly ArchiveTreeEntry[];
  /** The ordinal to pass as `after` for the next page, or null after the last one. */
  readonly next: number | null;
}

/**
 * Reads the table of contents with `content.read`: it names the files of the content and their
 * SHA-256. A missing, unpublished, foreign or forbidden artifact answers exactly as its
 * content download does (StorageService.artifact), so the route reveals no more than it.
 */
export class ArtifactTrees {
  constructor(
    private readonly storage: Pick<StorageService, 'artifact'>,
    private readonly index: TreeIndexRead,
  ) {}

  async page(
    principal: Principal,
    repository: string,
    id: string,
    after: number | undefined,
    limit: number = TREE_PAGE_LIMIT,
  ): Promise<ArtifactTreeView> {
    if (
      (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > TREE_PAGE_LIMIT
    )
      throw new ArkvoryError('invalid_input', 'Invalid table of contents page');
    const upload = await this.storage.artifact(principal, repository, id, 'content.read');
    const archiveSha256 = upload.descriptor.sha256;
    const empty = { archiveSha256, entries: null, items: [], next: null };
    const state = await this.index.state(upload.id);
    if (!state)
      return treeIndexable(upload.descriptor.name)
        ? { status: 'pending', reason: null, ...empty }
        : { status: 'unavailable', reason: 'not_archive', ...empty };
    if (state.status === 'unavailable')
      return { status: 'unavailable', reason: state.reason ?? 'invalid_archive', ...empty };
    // Past the last possible ordinal there is nothing to read.
    const start = after ?? -1;
    const rows =
      start >= TREE_MAX_ENTRIES ? [] : await this.index.entries(upload.id, start, limit + 1);
    const items = rows.slice(0, limit);
    return {
      status: 'ready',
      reason: null,
      archiveSha256,
      entries: state.entries ?? 0,
      items,
      next: rows.length > limit ? (items.at(-1)?.ordinal ?? null) : null,
    };
  }
}

/** A published archive that has no table of contents yet. */
export interface TreeIndexCandidate {
  readonly id: string;
  readonly repository: string;
  readonly size: number;
  readonly storageBackend?: string | undefined;
}

export interface TreeIndexQueue {
  /** Published archives without a stored outcome, oldest first, leaving out `skip`. */
  pending(limit: number, skip: readonly string[]): Promise<readonly TreeIndexCandidate[]>;
}

export interface ArchiveTreeBuilder {
  /**
   * Reads the archive through the storage port. Defects of the archive are an `unavailable`
   * result; a storage failure, a lost content pin and the abort are thrown, so it is retried.
   */
  build(blob: TreeIndexCandidate, cancellation: Cancellation): Promise<ArchiveTree>;
}

export interface TreeIndexStore {
  /**
   * Stores the outcome and all its entries at once, only for an upload that is still
   * published. False when another pass stored one first or the upload is gone: nothing changed.
   */
  save(uploadId: string, tree: ArchiveTree): Promise<boolean>;
}

export type TreeIndexOutcome =
  | { readonly kind: 'ready'; readonly id: string; readonly entries: number }
  | { readonly kind: 'unavailable'; readonly id: string; readonly reason: string }
  | { readonly kind: 'skipped'; readonly id: string }
  | {
      readonly kind: 'failed';
      readonly id: string;
      readonly errorCode: string;
      readonly attempts: number;
      readonly retryInMs: number;
    };

/** First pause after a failed attempt; it doubles up to an hour. */
const firstRetryMs = 30_000;
const maxRetryMs = 3_600_000;
/** Uploads remembered as failing; the oldest is forgotten first and only retried sooner. */
const maxRemembered = 10_000;

function stopped(cancellation: Cancellation): boolean {
  try {
    cancellation.throwIfAborted();
    return false;
  } catch {
    return true;
  }
}

export function treeRetryMs(attempts: number): number {
  return Math.min(firstRetryMs * 2 ** Math.min(Math.max(attempts - 1, 0), 16), maxRetryMs);
}

/**
 * One pass of the worker over archives without a table of contents (ADR 0083, N8). An archive
 * whose storage fails is retried after a pause that doubles up to an hour and is left out of
 * the passes until then, so it never holds back the others. The pauses live in this process:
 * a restarted worker tries every archive again once.
 */
export class TreeIndexer {
  private readonly failures = new Map<string, { attempts: number; until: number }>();

  constructor(
    private readonly queue: TreeIndexQueue,
    private readonly builder: ArchiveTreeBuilder,
    private readonly store: TreeIndexStore,
    /** Monotonic milliseconds. */
    private readonly now: () => number,
    private readonly batch = 10,
  ) {}

  /**
   * Indexes at most `batch` archives; resolves with what happened to each of them, each also
   * told to `report` as soon as it is known (it must not throw).
   */
  async pass(
    cancellation: Cancellation,
    report: (outcome: TreeIndexOutcome) => void = () => undefined,
  ): Promise<readonly TreeIndexOutcome[]> {
    const now = this.now();
    // A failure is remembered past its pause, so the next one doubles.
    const waiting = [...this.failures].filter(([, failure]) => failure.until > now);
    const candidates = await this.queue.pending(
      this.batch,
      waiting.map(([id]) => id),
    );
    const outcomes: TreeIndexOutcome[] = [];
    for (const candidate of candidates) {
      cancellation.throwIfAborted();
      const outcome = await this.index(candidate, cancellation);
      report(outcome);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async index(
    candidate: TreeIndexCandidate,
    cancellation: Cancellation,
  ): Promise<TreeIndexOutcome> {
    const { id } = candidate;
    try {
      const tree = await this.builder.build(candidate, cancellation);
      if (!(await this.store.save(id, tree))) return { kind: 'skipped', id };
      this.failures.delete(id);
      return tree.status === 'ready'
        ? { kind: 'ready', id, entries: tree.entries.length }
        : { kind: 'unavailable', id, reason: tree.reason };
    } catch (error) {
      // Stopping is not a failure of the archive: it is taken again by the next worker.
      if (stopped(cancellation)) throw error;
      const attempts = (this.failures.get(id)?.attempts ?? 0) + 1;
      const retryInMs = treeRetryMs(attempts);
      this.failures.delete(id);
      this.failures.set(id, { attempts, until: this.now() + retryInMs });
      while (this.failures.size > maxRemembered) {
        const oldest = this.failures.keys().next();
        if (oldest.done) break;
        this.failures.delete(oldest.value);
      }
      const errorCode = error instanceof ArkvoryError ? error.code : 'internal';
      return { kind: 'failed', id, errorCode, attempts, retryInMs };
    }
  }
}

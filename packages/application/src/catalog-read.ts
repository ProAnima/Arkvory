import {
  ArkvoryError,
  authorizeAction,
  requireAssetPath,
  requireId,
  requireRepository,
} from '@proanima/arkvory-domain';
import type { Principal, Upload } from '@proanima/arkvory-domain';
import type { ArtifactCatalog } from './catalog.js';
import type { GlobalSearch, GlobalSearchInput, GlobalSearchPage } from './global-search.js';
import type { StorageService } from './storage.js';
import type { AssetEntry } from './asset-page.js';

/** A published artifact as a scope sees it; `metadata` when every principal may read it. */
export interface ScopedArtifact {
  readonly upload: Upload;
  readonly metadata: boolean;
}

/** Protection of content against removal while it is read (ADR 0035). */
export interface ContentPin {
  /** Throws once the protection is lost. */
  check(): void;
  release(): Promise<void>;
}
export interface ContentPinning {
  /** `busy` while the content is being reclaimed. */
  acquire(id: string): Promise<ContentPin>;
}

/** Pinned bytes of a published artifact. */
export interface ScopedContent {
  readonly upload: Upload;
  read(range?: { start: number; end: number }): AsyncIterable<Uint8Array>;
  readonly pin: ContentPin;
}

const MAX_PAGE = 100;
const MAX_BATCH = 100;

/** A refusal that must look like absence: no existence oracle (ADR 0083, N4). */
function hidden(error: unknown): boolean {
  return (
    error instanceof ArkvoryError && (error.code === 'not_found' || error.code === 'forbidden')
  );
}

async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (hidden(error)) return null;
    throw error;
  }
}

function allowedToAll(
  principals: readonly Principal[],
  repository: string,
  action: 'annotation.read' | 'artifact.list',
) {
  if (principals.length === 0) return false;
  try {
    for (const principal of principals) authorizeAction(principal, repository, action, ['read']);
    return true;
  } catch (error) {
    if (error instanceof ArkvoryError) return false;
    throw error;
  }
}

/** The package filter rules of `ArtifactCatalog.resolvePackage`, checked before any rights. */
function requirePackageQuery(query: {
  readonly group: unknown;
  readonly name: unknown;
  readonly version: unknown;
}): void {
  const { group, name, version } = query;
  const text = (value: unknown, min: number) =>
    typeof value === 'string' && value.length >= min && value.length <= 128;
  if (!text(group, 0) || !text(name, 1) || (version !== null && !text(version, 0)))
    throw new ArkvoryError('invalid_input', 'Invalid package filter');
}

/**
 * Reading the catalog for modules with the rights of a scope (ADR 0083, N4): every principal
 * of the scope must be allowed, through the same use cases and checks as `/api/v1`. Absent,
 * unpublished, forbidden and unknown repository all read as null; malformed input is
 * `invalid_input` whatever the rights, so the answer never depends on what exists.
 */
export class ScopedCatalog {
  constructor(
    private readonly storage: Pick<StorageService, 'artifact' | 'list' | 'download'>,
    private readonly browse: Pick<ArtifactCatalog, 'resolvePackage' | 'asset'>,
    private readonly finder: Pick<GlobalSearch, 'searchAll'>,
    private readonly pins: ContentPinning,
  ) {}

  async artifact(
    principals: readonly Principal[],
    repository: string,
    id: string,
  ): Promise<ScopedArtifact | null> {
    requireRepository(repository);
    requireId(id);
    if (principals.length === 0) return null;
    let upload: Upload | undefined;
    for (const principal of principals) {
      const visible = await orNull(() => this.storage.artifact(principal, repository, id));
      if (visible === null) return null;
      upload = visible;
    }
    return upload
      ? { upload, metadata: allowedToAll(principals, repository, 'annotation.read') }
      : null;
  }

  async artifacts(
    principals: readonly Principal[],
    repository: string,
    after: string | null,
    limit: number,
  ) {
    requireRepository(repository);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE)
      throw new ArkvoryError('invalid_input', 'Invalid page limit');
    if (after !== null) requireId(after);
    const [first] = principals;
    if (first === undefined || !allowedToAll(principals, repository, 'artifact.list'))
      return { items: [], next: null };
    // A full page has a cursor; the page after the last full one may then be empty.
    const rows = await this.storage.list(first, repository, after ?? undefined, limit);
    const metadata = allowedToAll(principals, repository, 'annotation.read');
    const page = rows.map((upload) => ({ upload, metadata }));
    return { items: page, next: rows.length === limit ? (page.at(-1)?.upload.id ?? null) : null };
  }

  async batch(principals: readonly Principal[], repository: string, ids: readonly string[]) {
    requireRepository(repository);
    if (ids.length > MAX_BATCH) throw new ArkvoryError('invalid_input', 'Too many ids');
    for (const id of ids) requireId(id);
    const found: ScopedArtifact[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const artifact = await this.artifact(principals, repository, id);
      if (artifact) found.push(artifact);
      else missing.push(id);
    }
    return { found, missing };
  }

  /** The artifact a package resolves to, visible only with `content.read` and `artifact.read`. */
  async resolvePackage(
    principals: readonly Principal[],
    repository: string,
    query: { readonly group: string; readonly name: string; readonly version: string | null },
  ): Promise<ScopedArtifact | null> {
    requireRepository(repository);
    requirePackageQuery(query);
    let id: string | null = null;
    for (const principal of principals) {
      const resolved = await orNull(() =>
        this.browse.resolvePackage(
          principal,
          repository,
          query.group,
          query.name,
          query.version ?? undefined,
        ),
      );
      if (resolved === null || (id !== null && resolved !== id)) return null;
      id = resolved;
    }
    return id === null ? null : this.artifact(principals, repository, id);
  }

  async asset(
    principals: readonly Principal[],
    repository: string,
    path: string,
  ): Promise<AssetEntry | null> {
    requireRepository(repository);
    requireAssetPath(path);
    let entry: AssetEntry | null = null;
    for (const principal of principals) {
      entry = await orNull(() => this.browse.asset(principal, repository, path));
      if (entry === null) return null;
    }
    return entry;
  }

  search(principals: readonly Principal[], input: GlobalSearchInput): Promise<GlobalSearchPage> {
    return this.finder.searchAll(principals, input);
  }

  /**
   * Pinned content: the scope must be allowed `content.read` before the pin is taken, so a
   * refusal of the pin (`busy`, content being reclaimed) reaches only callers with the right;
   * under the pin the artifact is read again, as a download does, and the pin is released when
   * it is no longer visible.
   */
  async content(
    principals: readonly Principal[],
    repository: string,
    id: string,
  ): Promise<ScopedContent | null> {
    requireRepository(repository);
    requireId(id);
    if (principals.length === 0) return null;
    for (const principal of principals)
      if (
        (await orNull(() => this.storage.artifact(principal, repository, id, 'content.read'))) ===
        null
      )
        return null;
    const pin = await this.pins.acquire(id);
    try {
      let opened: Awaited<ReturnType<StorageService['download']>> | null = null;
      for (const principal of principals) {
        opened = await orNull(() => this.storage.download(principal, repository, id));
        if (opened === null) break;
      }
      pin.check();
      if (opened === null) {
        await pin.release();
        return null;
      }
      return { upload: opened.upload, read: opened.read, pin };
    } catch (error) {
      await pin.release();
      throw error;
    }
  }
}

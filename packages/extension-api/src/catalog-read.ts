import type { BlobDescriptor, ByteRange, Page, PageRequest } from './portable.js';

declare const accessScopeBrand: unique symbol;

/**
 * Whose rights a read uses (ADR 0083, N4): the principal of a route request, the service
 * principal of a module, or the intersection of such scopes. Opaque: only the core creates one,
 * a module can narrow it with `CatalogRead.intersect` but never build or widen it. An object the
 * core did not create reads as a scope without rights.
 */
export interface AccessScope {
  readonly [accessScopeBrand]: true;
}

/** A published artifact as the core shows it to the scope. */
export interface ArtifactView {
  readonly repository: string;
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly labels: readonly string[];
  /** Descriptor metadata, or null when the scope may not read annotations (`annotation.read`). */
  readonly metadata: Readonly<Record<string, string>> | null;
  readonly createdAt: string;
}

/** Ids of one batch: visible artifacts and, together, the absent and the inaccessible ones. */
export interface BatchView {
  readonly found: readonly ArtifactView[];
  readonly missing: readonly string[];
}

export interface PackageQuery {
  readonly group: string;
  readonly name: string;
  /** An exact version; null resolves the latest one. */
  readonly version: string | null;
}

export interface PackageView {
  readonly group: string;
  readonly name: string;
  readonly artifact: ArtifactView;
}

export interface AssetView {
  readonly path: string;
  readonly revision: number;
  readonly artifactId: string;
}

/** Installation-wide search in the repositories the scope may list (ADR 0075 bounds). */
export interface SearchQuery extends PageRequest {
  readonly text: string;
  /** At most 100 repositories; an inaccessible one is dropped like an absent one. */
  readonly repositories: readonly string[];
  readonly labels: readonly string[];
  readonly stage: string | null;
}

/** One search result; `CatalogRead.artifact` gives the descriptor and metadata. */
export interface SearchHit {
  readonly repository: string;
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly labels: readonly string[];
  readonly stages: readonly string[];
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

/**
 * Reading the catalog with the rights of a scope (service `catalog-read`). There is no existence
 * oracle: null means alike "absent", "not published", "no right" and "no such repository", and
 * a batch lists inaccessible ids in `missing` together with absent ones. The core checks the
 * rights with the same use cases as `/api/v1`; a module sees no SQL. Pages hold at most 100
 * items, a batch at most 100 ids; cursors are opaque.
 */
export interface CatalogRead {
  artifact(scope: AccessScope, repository: string, id: string): Promise<ArtifactView | null>;
  artifacts(scope: AccessScope, repository: string, page: PageRequest): Promise<Page<ArtifactView>>;
  batch(scope: AccessScope, repository: string, ids: readonly string[]): Promise<BatchView>;
  resolvePackage(
    scope: AccessScope,
    repository: string,
    query: PackageQuery,
  ): Promise<PackageView | null>;
  asset(scope: AccessScope, repository: string, path: string): Promise<AssetView | null>;
  search(scope: AccessScope, query: SearchQuery): Promise<Page<SearchHit>>;
  /** A scope with only the rights both scopes have. */
  intersect(first: AccessScope, second: AccessScope): AccessScope;
}

/** A published blob by its artifact. */
export interface ContentRef {
  readonly repository: string;
  readonly id: string;
}

/**
 * Bytes of a published blob, protected from removal until `release` (ADR 0035). The caller
 * releases it as soon as it is done, at the latest when its response ends; reading after
 * `release` fails with `unavailable`.
 */
export interface ContentHandle {
  readonly descriptor: BlobDescriptor;
  read(range?: ByteRange): AsyncIterable<Uint8Array>;
  /** Idempotent. */
  release(): Promise<void>;
}

/**
 * Reading content with the rights of a scope (service `content-read`): `content.read` is checked
 * and the content is pinned against cleanup before the handle is given. Null as in `CatalogRead`.
 */
export interface ContentRead {
  open(scope: AccessScope, ref: ContentRef, range?: ByteRange): Promise<ContentHandle | null>;
}

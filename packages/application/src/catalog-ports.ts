import type { PackageManifest, MutationAccess } from '@proanima/arkvory-domain';
import type { AssetEntry, AssetPage, AssetPageOptions } from './asset-page.js';

export interface Annotation {
  revision: number;
  labels: readonly string[];
  metadata: Readonly<Record<string, string>>;
  collections: readonly string[];
}
export interface PackageEntry {
  group: string;
  name: string;
  version: string;
  artifactId: string;
  manifest: Readonly<Record<string, unknown>>;
}
export interface PackageListOptions {
  sort: 'group' | 'name' | 'version';
  direction: 'asc' | 'desc';
  groupBy: 'none' | 'group' | 'package';
}
export interface PackagePage {
  items: readonly PackageEntry[];
  next: string | null;
}
export interface AssetRevision extends AssetEntry {
  actor: string | null;
  createdAt: string | null;
  sourceRevision: number | null;
}
export interface AssetHistoryPage {
  items: readonly AssetRevision[];
  next: number | null;
}
export interface CatalogAuditEntry {
  sequence: string;
  actor: string;
  action: string;
  artifactId: string;
  occurredAt: string;
}
/** One change of the repository feed (ADR 0058); `detail` is the asset path or the stage. */
export interface CatalogFeedEntry {
  sequence: string;
  action: string;
  artifactId: string;
  detail: string | null;
}
export interface CatalogFeedPage {
  items: readonly CatalogFeedEntry[];
  /** Newest committed sequence of the repository, "0" for an empty journal. */
  head: string;
}
/**
 * One available artifact in search results. `size` is a decimal string (full 64-bit precision);
 * `labels` are the current labels (annotation when replaced, otherwise the upload descriptor);
 * `stages` are the current promotion stages in "C" collation order, at most MAX_STAGES.
 * `publishedAt` is null only for rows that never recorded a publication time.
 */
export interface ArtifactSearchItem {
  id: string;
  name: string;
  size: string;
  createdAt: string;
  publishedAt: string | null;
  labels: readonly string[];
  stages: readonly string[];
}

/*
 * Mutating methods receive MutationAccess: the implementation re-checks a managed key inside the
 * mutation transaction, so a key revoked after request authorization cannot commit the change.
 */
export interface AnnotationStore {
  annotation(repository: string, id: string): Promise<Annotation>;
  annotate(
    repository: string,
    id: string,
    expected: number,
    annotation: Omit<Annotation, 'revision'>,
    actor: string,
    access: MutationAccess,
  ): Promise<Annotation>;
}
export interface PackageCatalogStore {
  register(
    repository: string,
    id: string,
    manifest: PackageManifest,
    actor: string,
    access: MutationAccess,
  ): Promise<PackageEntry>;
  resolvePackage(
    repository: string,
    group: string,
    name: string,
    version: string | undefined,
  ): Promise<string | null>;
  packagePage(
    repository: string,
    group: string | undefined,
    name: string | undefined,
    options: PackageListOptions,
    after: string | undefined,
    limit: number,
  ): Promise<PackagePage>;
}
export interface AssetCatalogStore {
  asset(repository: string, path: string): Promise<AssetEntry>;
  assetRevision(repository: string, path: string, revision: number): Promise<AssetRevision>;
  assetHistory(repository: string, path: string, before?: number): Promise<AssetHistoryPage>;
  assets(repository: string, prefix: string): Promise<readonly AssetEntry[]>;
  assetPage(repository: string, options: AssetPageOptions): Promise<AssetPage>;
  setAsset(
    repository: string,
    path: string,
    id: string,
    expected: number,
    actor: string,
    access: MutationAccess,
    sourceRevision?: number,
  ): Promise<AssetEntry>;
}
export interface ArtifactSearchStore {
  /** At most 100 items ordered by artifact ID, strictly after `after` when given. */
  search(
    repository: string,
    query: string,
    label: string,
    collection: string,
    after: string | undefined,
    metadata?: { key: string; value: string },
  ): Promise<readonly ArtifactSearchItem[]>;
}
export interface CatalogJournalStore {
  audit(repository: string, after: string): Promise<readonly CatalogAuditEntry[]>;
  changes(repository: string, after: string, limit: number): Promise<CatalogFeedPage>;
  reference(
    repository: string,
    id: string,
    owner: string,
    access: MutationAccess,
    key: string,
    remove: boolean,
  ): Promise<void>;
}
export interface BrowseStore
  extends
    AnnotationStore,
    PackageCatalogStore,
    AssetCatalogStore,
    ArtifactSearchStore,
    CatalogJournalStore {}

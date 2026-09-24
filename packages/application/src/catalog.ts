import {
  authorizeAction,
  DepotError,
  parseDescriptor,
  requireId,
  requireAssetPath,
} from '@proanima/depot-domain';
import type { Principal, PackageManifest, MutationAccess } from '@proanima/depot-domain';
import type { StorageService } from './storage.js';
import { validateAssetPage } from './asset-page.js';
import type { AssetEntry, AssetPage, AssetPageOptions } from './asset-page.js';
export type { AssetEntry } from './asset-page.js';

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
export interface BrowseStore {
  annotation(repository: string, id: string): Promise<Annotation>;
  annotate(
    repository: string,
    id: string,
    expected: number,
    annotation: Omit<Annotation, 'revision'>,
    actor: string,
    access: MutationAccess,
  ): Promise<Annotation>;
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
  search(
    repository: string,
    query: string,
    label: string,
    collection: string,
    after: string | undefined,
  ): Promise<readonly { id: string; name: string }[]>;
  audit(
    repository: string,
    after: string,
  ): Promise<
    readonly {
      sequence: string;
      actor: string;
      action: string;
      artifactId: string;
      occurredAt: string;
    }[]
  >;
  reference(
    repository: string,
    id: string,
    owner: string,
    access: MutationAccess,
    key: string,
    remove: boolean,
  ): Promise<void>;
}
export interface ManifestReader {
  inspect(id: string): Promise<PackageManifest>;
}

export class ArtifactCatalog {
  constructor(
    private readonly storage: StorageService,
    private readonly store: BrowseStore,
    private readonly manifests: ManifestReader,
  ) {}
  async annotation(p: Principal, repo: string, id: string) {
    await this.storage.artifact(p, repo, id, 'annotation.read');
    return this.store.annotation(repo, id);
  }
  async annotate(p: Principal, repo: string, id: string, expected: number, value: unknown) {
    authorizeAction(p, repo, 'annotation.write', ['write']);
    const upload = await this.storage.artifact(p, repo, id);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new DepotError('invalid_input', 'Invalid annotations');
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    if (Object.keys(input).some((key) => !['labels', 'metadata', 'collections'].includes(key)))
      throw new DepotError('invalid_input', 'Unknown annotation field');
    this.revision(expected);
    const fields = parseDescriptor({
      name: upload.descriptor.name,
      size: String(upload.descriptor.size),
      sha256: upload.descriptor.sha256,
      labels: input['labels'],
      metadata: input['metadata'],
    });
    const collections = parseDescriptor({
      name: 'collections',
      size: '0',
      sha256: '0'.repeat(64),
      labels: input['collections'],
    }).labels;
    return this.store.annotate(
      repo,
      id,
      expected,
      { labels: fields.labels, metadata: fields.metadata, collections },
      p.id,
      { principal: p, repository: repo, actions: ['annotation.write', 'artifact.read'] },
    );
  }
  async register(p: Principal, repo: string, id: string) {
    authorizeAction(p, repo, 'package.publish', ['write']);
    await this.storage.artifact(p, repo, id);
    return this.store.register(repo, id, await this.manifests.inspect(id), p.id, {
      principal: p,
      repository: repo,
      actions: ['package.publish', 'artifact.read'],
    });
  }
  async resolvePackage(p: Principal, repo: string, group: string, name: string, version?: string) {
    authorizeAction(p, repo, 'content.read', ['read']);
    if (
      group.length > 128 ||
      name.length === 0 ||
      name.length > 128 ||
      (version?.length ?? 0) > 128
    )
      throw new DepotError('invalid_input', 'Invalid package filter');
    return this.store.resolvePackage(repo, group, name, version);
  }
  async packagePage(
    p: Principal,
    repo: string,
    group: string | undefined,
    name: string | undefined,
    options: PackageListOptions,
    after: string | undefined,
    limit: number,
  ): Promise<PackagePage> {
    authorizeAction(p, repo, 'package.read', ['read']);
    if (
      (group?.length ?? 0) > 128 ||
      (name?.length ?? 0) > 128 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new DepotError('invalid_input', 'Invalid package page');
    return this.store.packagePage(repo, group, name, options, after, limit);
  }
  async resolveAssetContent(p: Principal, repo: string, path: string) {
    authorizeAction(p, repo, 'content.read', ['read']);
    return this.store.asset(repo, requireAssetPath(path));
  }
  async asset(p: Principal, repo: string, path: string) {
    authorizeAction(p, repo, 'asset.read', ['read']);
    return this.store.asset(repo, requireAssetPath(path));
  }
  async assets(p: Principal, repo: string, prefix: string) {
    authorizeAction(p, repo, 'asset.read', ['read']);
    if (prefix.length > 1024) throw new DepotError('invalid_input', 'Invalid prefix');
    return this.store.assets(repo, prefix);
  }
  async assetPage(p: Principal, repo: string, options: AssetPageOptions): Promise<AssetPage> {
    authorizeAction(p, repo, 'asset.read', ['read']);
    validateAssetPage(options);
    return this.store.assetPage(repo, options);
  }
  async assetRevision(p: Principal, repo: string, path: string, revision: number) {
    authorizeAction(p, repo, 'asset.read', ['read']);
    this.existingRevision(revision);
    return this.store.assetRevision(repo, requireAssetPath(path), revision);
  }
  async assetHistory(p: Principal, repo: string, path: string, before?: number) {
    authorizeAction(p, repo, 'asset.read', ['read']);
    if (before !== undefined) this.existingRevision(before);
    return this.store.assetHistory(repo, requireAssetPath(path), before);
  }
  async restoreAsset(
    p: Principal,
    repo: string,
    path: string,
    sourceRevision: number,
    expected: number,
  ) {
    authorizeAction(p, repo, 'asset.restore', ['write']);
    this.revision(expected);
    if (expected === 0) throw new DepotError('invalid_input', 'Restore requires an existing asset');
    const source = await this.assetRevision(p, repo, path, sourceRevision);
    await this.storage.artifact(p, repo, source.artifactId);
    return this.store.setAsset(
      repo,
      source.path,
      source.artifactId,
      expected,
      p.id,
      { principal: p, repository: repo, actions: ['asset.restore', 'asset.read', 'artifact.read'] },
      sourceRevision,
    );
  }
  async setAsset(p: Principal, repo: string, path: string, id: string, expected: number) {
    authorizeAction(p, repo, 'asset.write', ['write']);
    await this.storage.artifact(p, repo, requireId(id));
    this.revision(expected);
    return this.store.setAsset(repo, requireAssetPath(path), id, expected, p.id, {
      principal: p,
      repository: repo,
      actions: ['asset.write', 'artifact.read'],
    });
  }
  async search(
    p: Principal,
    repo: string,
    query: string,
    label: string,
    collection: string,
    after?: string,
  ) {
    authorizeAction(p, repo, 'artifact.list', ['read']);
    if (query.length > 240 || label.length > 64 || collection.length > 64)
      throw new DepotError('invalid_input', 'Search filter too long');
    if (after !== undefined) requireId(after);
    return this.store.search(repo, query, label, collection, after);
  }
  async audit(p: Principal, repo: string, after: string) {
    authorizeAction(p, repo, 'audit.read', ['write']);
    if (!/^[0-9]{1,18}$/.test(after)) throw new DepotError('invalid_input', 'Invalid audit cursor');
    return this.store.audit(repo, after);
  }
  async reference(p: Principal, repo: string, id: string, key: string, remove: boolean) {
    authorizeAction(p, repo, 'reference.write', ['write']);
    await this.storage.artifact(p, repo, id);
    if (!/^[a-zA-Z0-9_.:/-]{1,256}$/.test(key))
      throw new DepotError('invalid_input', 'Invalid reference');
    await this.store.reference(
      repo,
      id,
      p.id,
      { principal: p, repository: repo, actions: ['reference.write', 'artifact.read'] },
      key,
      remove,
    );
  }
  private revision(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483646)
      throw new DepotError('invalid_input', 'Invalid expected revision');
  }
  private existingRevision(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
      throw new DepotError('invalid_input', 'Invalid asset revision');
  }
}

import {
  authorizeAction,
  ArkvoryError,
  fieldError,
  parseDescriptor,
  requireId,
  requireAssetPath,
  withField,
} from '@proanima/arkvory-domain';
import type { Principal, PackageManifest } from '@proanima/arkvory-domain';
import type { StorageService } from './storage.js';
import { validateAssetPage } from './asset-page.js';
import type { AssetPage, AssetPageOptions } from './asset-page.js';
import type { BrowseStore, PackageListOptions, PackagePage } from './catalog-ports.js';
export type { AssetEntry } from './asset-page.js';

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
      throw fieldError('/', 'type', 'Invalid annotations');
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    const unknown = Object.keys(input).find(
      (key) => !['labels', 'metadata', 'collections'].includes(key),
    );
    if (unknown !== undefined)
      throw fieldError(`/${unknown.slice(0, 64)}`, 'unknown_field', 'Unknown annotation field');
    this.revision(expected);
    // Separate parses name the failing member; pointers are relative to the annotation value.
    const descriptor = (extra: Record<string, unknown>) =>
      parseDescriptor({
        name: upload.descriptor.name,
        size: String(upload.descriptor.size),
        sha256: upload.descriptor.sha256,
        ...extra,
      });
    const labels = withField('/labels', () => descriptor({ labels: input['labels'] }).labels);
    const metadata = withField(
      '/metadata',
      () => descriptor({ metadata: input['metadata'] }).metadata,
    );
    const collections = withField(
      '/collections',
      () => descriptor({ labels: input['collections'] }).labels,
    );
    return this.store.annotate(repo, id, expected, { labels, metadata, collections }, p.id, {
      principal: p,
      repository: repo,
      actions: ['annotation.write', 'artifact.read'],
    });
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
      throw new ArkvoryError('invalid_input', 'Invalid package filter');
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
      throw new ArkvoryError('invalid_input', 'Invalid package page');
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
    if (prefix.length > 1024) throw new ArkvoryError('invalid_input', 'Invalid prefix');
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
    if (expected === 0)
      throw new ArkvoryError('invalid_input', 'Restore requires an existing asset');
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
    metadata?: { key: string; value: string },
  ) {
    authorizeAction(p, repo, 'artifact.list', ['read']);
    if (query.length > 240 || label.length > 64 || collection.length > 64)
      throw new ArkvoryError('invalid_input', 'Search filter too long');
    if (after !== undefined) requireId(after);
    if (
      metadata &&
      (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(metadata.key) ||
        ['__proto__', 'constructor', 'prototype'].includes(metadata.key) ||
        metadata.value.length > 1024 ||
        metadata.value.includes('\0') ||
        /[\uD800-\uDFFF]/u.test(metadata.value))
    )
      throw new ArkvoryError('invalid_input', 'Invalid metadata filter');
    return this.store.search(repo, query, label, collection, after, metadata);
  }
  async audit(p: Principal, repo: string, after: string) {
    authorizeAction(p, repo, 'audit.read', ['write']);
    if (!/^[0-9]{1,18}$/.test(after))
      throw new ArkvoryError('invalid_input', 'Invalid audit cursor');
    return this.store.audit(repo, after);
  }
  /**
   * The repository change feed for mirrors (ADR 0058): readable with list access, without the
   * actors of the audit journal. A full page means more may follow from its last sequence.
   */
  async changes(p: Principal, repo: string, after: string, limit: number) {
    authorizeAction(p, repo, 'artifact.list', ['read']);
    if (!/^[0-9]{1,18}$/.test(after))
      throw new ArkvoryError('invalid_input', 'Invalid change cursor', {
        details: [{ field: 'after', problem: 'format' }],
      });
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ArkvoryError('invalid_input', 'limit must be 1 to 100', {
        details: [{ field: 'limit', problem: 'range' }],
      });
    const page = await this.store.changes(repo, after, limit);
    const last = page.items.at(-1);
    return { ...page, next: page.items.length === limit && last ? last.sequence : null };
  }
  async reference(p: Principal, repo: string, id: string, key: string, remove: boolean) {
    authorizeAction(p, repo, 'reference.write', ['write']);
    await this.storage.artifact(p, repo, id);
    if (!/^[a-zA-Z0-9_.:/-]{1,256}$/.test(key))
      throw new ArkvoryError('invalid_input', 'Invalid reference');
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
      throw new ArkvoryError('invalid_input', 'Invalid expected revision');
  }
  private existingRevision(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
      throw new ArkvoryError('invalid_input', 'Invalid asset revision');
  }
}

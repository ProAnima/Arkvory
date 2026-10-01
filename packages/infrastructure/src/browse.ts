import type { Pool } from 'pg';
import type { PackageManifest, MutationAccess } from '@proanima/arkvory-domain';
import type {
  Annotation,
  AssetEntry,
  AssetPageOptions,
  BrowseStore,
  PackageEntry,
  PackageListOptions,
  PackagePage,
} from '@proanima/arkvory-application';
import { readAnnotation, writeAnnotation } from './artifact-annotations.js';
import { searchArtifacts } from './artifact-search.js';
import { readAsset, readAssets } from './asset-list.js';
import { readAssetPage } from './asset-page.js';
import { readAssetHistory, readAssetRevision, writeAssetPointer } from './asset-revisions.js';
import { readCatalogAudit, writeReference } from './catalog-audit.js';
import { changePublished } from './catalog-change.js';
import { readPackagePage } from './package-page.js';
import { insertPackage, resolvePackageArtifact } from './package-registry.js';

/**
 * PostgreSQL catalog of published artifacts. Every mutation goes through changePublished, which
 * owns the transaction, lock order and audit row; the extracted modules hold the SQL per concern.
 */
export class PostgresBrowse implements BrowseStore {
  constructor(private readonly pool: Pool) {}
  annotation(repository: string, id: string): Promise<Annotation> {
    return readAnnotation(this.pool, repository, id);
  }
  annotate(
    repository: string,
    id: string,
    expected: number,
    value: Omit<Annotation, 'revision'>,
    actor: string,
    access: MutationAccess | undefined,
  ): Promise<Annotation> {
    return changePublished(
      this.pool,
      { repository, id, actor, action: 'annotations.replace', access },
      (client) => writeAnnotation(client, repository, id, expected, value),
    );
  }
  register(
    repository: string,
    id: string,
    manifest: PackageManifest,
    actor: string,
    access: MutationAccess | undefined,
  ): Promise<PackageEntry> {
    return changePublished(
      this.pool,
      { repository, id, actor, action: 'package.register', access },
      (client) => insertPackage(client, repository, id, manifest),
    );
  }
  resolvePackage(
    repository: string,
    group: string,
    name: string,
    version: string | undefined,
  ): Promise<string | null> {
    return resolvePackageArtifact(this.pool, repository, group, name, version);
  }
  packagePage(
    repository: string,
    group: string | undefined,
    name: string | undefined,
    options: PackageListOptions,
    after: string | undefined,
    limit: number,
  ): Promise<PackagePage> {
    return readPackagePage(this.pool, { repository, group, name, options }, after, limit);
  }
  asset(repository: string, path: string): Promise<AssetEntry> {
    return readAsset(this.pool, repository, path);
  }
  assets(repository: string, prefix: string): Promise<readonly AssetEntry[]> {
    return readAssets(this.pool, repository, prefix);
  }
  assetPage(repository: string, options: AssetPageOptions) {
    return readAssetPage(this.pool, repository, options);
  }
  assetRevision(repository: string, path: string, revision: number) {
    return readAssetRevision(this.pool, repository, path, revision);
  }
  assetHistory(repository: string, path: string, before?: number) {
    return readAssetHistory(this.pool, repository, path, before);
  }
  setAsset(
    repository: string,
    path: string,
    id: string,
    expected: number,
    actor: string,
    access: MutationAccess | undefined,
    sourceRevision?: number,
  ): Promise<AssetEntry> {
    const action = sourceRevision === undefined ? 'asset.replace' : 'asset.restore';
    return changePublished(this.pool, { repository, id, actor, action, access }, (client) =>
      writeAssetPointer(client, { repository, path, id, expected, actor, sourceRevision }),
    );
  }
  search(...args: Parameters<BrowseStore['search']>) {
    return searchArtifacts(this.pool, ...args);
  }
  audit(repository: string, after: string) {
    return readCatalogAudit(this.pool, repository, after);
  }
  async reference(
    repository: string,
    id: string,
    owner: string,
    access: MutationAccess | undefined,
    key: string,
    remove: boolean,
  ): Promise<void> {
    const action = remove ? 'reference.remove' : 'reference.add';
    await changePublished(this.pool, { repository, id, actor: owner, action, access }, (client) =>
      writeReference(client, { repository, id, owner, key, remove }),
    );
  }
}

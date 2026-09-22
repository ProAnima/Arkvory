import {
  authorize,
  DepotError,
  parseDescriptor,
  requireId,
  requireAssetPath,
} from '@proanima/depot-domain';
import type { Principal, PackageManifest } from '@proanima/depot-domain';
import type { StorageService } from './storage.js';

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
export interface AssetEntry {
  path: string;
  revision: number;
  artifactId: string;
}
export interface BrowseStore {
  annotation(repository: string, id: string): Promise<Annotation>;
  annotate(
    repository: string,
    id: string,
    expected: number,
    annotation: Omit<Annotation, 'revision'>,
    actor: string,
  ): Promise<Annotation>;
  register(
    repository: string,
    id: string,
    manifest: PackageManifest,
    actor: string,
  ): Promise<PackageEntry>;
  packages(
    repository: string,
    group: string | undefined,
    name: string | undefined,
  ): Promise<readonly PackageEntry[]>;
  asset(repository: string, path: string): Promise<AssetEntry>;
  assets(repository: string, prefix: string): Promise<readonly AssetEntry[]>;
  setAsset(
    repository: string,
    path: string,
    id: string,
    expected: number,
    actor: string,
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
    await this.storage.artifact(p, repo, id);
    return this.store.annotation(repo, id);
  }
  async annotate(p: Principal, repo: string, id: string, expected: number, value: unknown) {
    authorize(p, repo, 'write');
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
    );
  }
  async register(p: Principal, repo: string, id: string) {
    authorize(p, repo, 'write');
    await this.storage.artifact(p, repo, id);
    return this.store.register(repo, id, await this.manifests.inspect(id), p.id);
  }
  async packages(p: Principal, repo: string, group?: string, name?: string) {
    authorize(p, repo, 'read');
    if ((group?.length ?? 0) > 128 || (name?.length ?? 0) > 128)
      throw new DepotError('invalid_input', 'Invalid package filter');
    return this.store.packages(repo, group, name);
  }
  async asset(p: Principal, repo: string, path: string) {
    authorize(p, repo, 'read');
    return this.store.asset(repo, requireAssetPath(path));
  }
  async assets(p: Principal, repo: string, prefix: string) {
    authorize(p, repo, 'read');
    if (prefix.length > 1024) throw new DepotError('invalid_input', 'Invalid prefix');
    return this.store.assets(repo, prefix);
  }
  async setAsset(p: Principal, repo: string, path: string, id: string, expected: number) {
    authorize(p, repo, 'write');
    await this.storage.artifact(p, repo, requireId(id));
    this.revision(expected);
    return this.store.setAsset(repo, requireAssetPath(path), id, expected, p.id);
  }
  async search(
    p: Principal,
    repo: string,
    query: string,
    label: string,
    collection: string,
    after?: string,
  ) {
    authorize(p, repo, 'read');
    if (query.length > 240 || label.length > 64 || collection.length > 64)
      throw new DepotError('invalid_input', 'Search filter too long');
    if (after !== undefined) requireId(after);
    return this.store.search(repo, query, label, collection, after);
  }
  async audit(p: Principal, repo: string, after: string) {
    authorize(p, repo, 'write');
    if (!/^[0-9]{1,18}$/.test(after)) throw new DepotError('invalid_input', 'Invalid audit cursor');
    return this.store.audit(repo, after);
  }
  async reference(p: Principal, repo: string, id: string, key: string, remove: boolean) {
    authorize(p, repo, 'write');
    await this.storage.artifact(p, repo, id);
    if (!/^[a-zA-Z0-9_.:/-]{1,256}$/.test(key))
      throw new DepotError('invalid_input', 'Invalid reference');
    await this.store.reference(repo, id, p.id, key, remove);
  }
  private revision(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483646)
      throw new DepotError('invalid_input', 'Invalid expected revision');
  }
}

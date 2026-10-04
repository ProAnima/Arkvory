import {
  ArkvoryError,
  authorizeAction,
  npmIntegrityMatches,
  npmTarballFile,
  parseNpmManifest,
  parseNpmPublish,
  requireNpmName,
  requireNpmTag,
  requireNpmVersion,
} from '@proanima/arkvory-domain';
import type { NpmDigests, NpmVersionRecord, Principal } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type { StorageService } from './storage.js';

/** What the registry derives from a tarball's bytes, alike for a publish and for a mirror. */
export interface NpmTarballFacts {
  readonly size: number;
  /** package.json of the tarball, still unchecked. */
  readonly manifest: unknown;
  /** Hex. */
  readonly sha1: string;
  readonly sha256: string;
  /** Base64, for Subresource Integrity. */
  readonly integrity: NpmDigests;
}
export interface NpmTarballInspector {
  inspect(source: AsyncIterable<Uint8Array>): Promise<NpmTarballFacts>;
}
/** The tarball of an `npm publish` body, staged; its JSON document stays bounded in memory. */
export interface NpmPublishStaging {
  stage(
    body: AsyncIterable<Uint8Array>,
    limit: number,
    cancellation: Cancellation,
  ): Promise<{ readonly id: string; readonly document: unknown; readonly attachments: number }>;
  read(id: string): AsyncIterable<Uint8Array>;
  /** Idempotent. */
  remove(id: string): Promise<void>;
}
export interface NpmVersionRow extends NpmVersionRecord {
  readonly artifactId: string;
}
export interface NewNpmVersion {
  readonly name: string;
  readonly version: string;
  readonly artifactId: string;
  readonly file: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly description: string | null;
  readonly keywords: readonly string[];
  readonly shasum: string;
  readonly integrity: string;
}
export interface NpmSearchItem {
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly keywords: readonly string[];
  readonly date: string;
}
/** Versions whose artifact is still available; tags only for those. */
export interface NpmIndexReader {
  versions(repository: string, name: string): Promise<readonly NpmVersionRow[]>;
  tags(repository: string, name: string): Promise<Readonly<Record<string, string>>>;
  tarball(repository: string, name: string, file: string): Promise<string | null>;
  /** dist.shasum of an available version, null when there is none. */
  shasum(repository: string, name: string, version: string): Promise<string | null>;
  search(
    repository: string,
    text: string,
    from: number,
    size: number,
  ): Promise<{ readonly total: number; readonly packages: readonly NpmSearchItem[] }>;
}
/** Every change is journaled in the repository feed (`npm.*`) in its own transaction. */
export interface NpmIndexWriter {
  /**
   * Adds the version and points the tags at it. A version whose artifact is gone is replaced;
   * otherwise the existing row stays and comes back with `created` false.
   */
  addVersion(
    actor: Principal,
    repository: string,
    version: NewNpmVersion,
    tags: readonly string[],
  ): Promise<{ readonly created: boolean; readonly shasum: string }>;
  /** False when the version is unknown. */
  setTag(
    actor: Principal,
    repository: string,
    name: string,
    tag: string,
    version: string,
  ): Promise<boolean>;
  removeTag(actor: Principal, repository: string, name: string, tag: string): Promise<boolean>;
}

type Storage = Pick<StorageService, 'create' | 'upload' | 'maxObjectBytes'>;
const mismatch = (message: string) => new ArkvoryError('integrity_mismatch', message);
const versionExists = () =>
  new ArkvoryError('conflict', 'This version was published with other content', {
    reason: 'version_exists',
  });

/** The index row of a tarball; its package.json must be a valid manifest. */
export function npmVersionOf(facts: NpmTarballFacts, artifactId: string): NewNpmVersion {
  const manifest = parseNpmManifest(facts.manifest);
  return {
    name: manifest.name,
    version: manifest.version,
    artifactId,
    file: npmTarballFile(manifest.name, manifest.version),
    manifest: manifest.document,
    description: manifest.description,
    keywords: manifest.keywords,
    shasum: facts.sha1,
    integrity: `sha512-${facts.integrity.sha512}`,
  };
}

function checkDeclared(
  declared: ReturnType<typeof parseNpmPublish>['declared'],
  facts: NpmTarballFacts,
) {
  if (declared.length !== null && declared.length !== facts.size)
    throw mismatch('The tarball length differs from the declared one');
  if (declared.shasum !== null && declared.shasum !== facts.sha1)
    throw mismatch('The tarball does not match dist.shasum');
  if (declared.integrity !== null && !npmIntegrityMatches(declared.integrity, facts.integrity))
    throw mismatch('The tarball does not match dist.integrity');
}

/**
 * An npm-compatible registry per repository (ADR 0066), the scoped registry of Unity Package
 * Manager. A version is a tarball artifact plus an index row derived from the tarball's own
 * package.json; it never changes. Reading needs content.read, listing artifact.list, publishing
 * and moving or removing tags the upload actions; `latest` always stays.
 */
export class NpmRegistry {
  constructor(
    private readonly storage: Storage,
    private readonly staging: NpmPublishStaging,
    private readonly inspector: NpmTarballInspector,
    private readonly reader: NpmIndexReader,
    private readonly writer: NpmIndexWriter,
  ) {}

  async packument(principal: Principal, repository: string, name: string) {
    authorizeAction(principal, repository, 'content.read', ['read']);
    requireNpmName(name);
    const versions = await this.reader.versions(repository, name);
    if (versions.length === 0) throw new ArkvoryError('not_found', 'Package not found');
    return { versions, tags: await this.reader.tags(repository, name) };
  }

  async tarball(principal: Principal, repository: string, name: string, file: string) {
    authorizeAction(principal, repository, 'content.read', ['read']);
    requireNpmName(name);
    const artifactId = await this.reader.tarball(repository, name, file);
    if (artifactId === null) throw new ArkvoryError('not_found', 'Tarball not found');
    return artifactId;
  }

  async search(principal: Principal, repository: string, text: string, from: number, size: number) {
    authorizeAction(principal, repository, 'artifact.list', ['read']);
    return this.reader.search(repository, text.slice(0, 256), from, size);
  }

  async tags(principal: Principal, repository: string, name: string) {
    authorizeAction(principal, repository, 'artifact.list', ['read']);
    return this.reader.tags(repository, requireNpmName(name));
  }

  async setTag(principal: Principal, repository: string, name: string, tag: string, to: unknown) {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const version = requireNpmVersion(to);
    if (
      !(await this.writer.setTag(
        principal,
        repository,
        requireNpmName(name),
        requireNpmTag(tag),
        version,
      ))
    )
      throw new ArkvoryError('not_found', 'Version not found');
  }

  /** `latest` always names a version, as npm itself keeps it. */
  async removeTag(principal: Principal, repository: string, name: string, tag: string) {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    if (requireNpmTag(tag) === 'latest')
      throw new ArkvoryError('conflict', 'The latest dist-tag cannot be removed', {
        reason: 'state_conflict',
      });
    if (!(await this.writer.removeTag(principal, repository, requireNpmName(name), tag)))
      throw new ArkvoryError('not_found', 'Dist-tag not found');
  }

  /**
   * `npm publish`: the tarball is staged out of the body, inspected, then stored as an artifact
   * keyed by its SHA-256, so a retried publish resumes the same artifact. The same tarball again
   * is a success without a change (`created` false); other content for a version is refused.
   */
  async publish(
    principal: Principal,
    repository: string,
    name: string,
    body: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<{ readonly created: boolean }> {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    requireNpmName(name);
    const staged = await this.staging.stage(body, this.storage.maxObjectBytes, cancellation);
    try {
      const request = parseNpmPublish(staged.document, name);
      if (staged.attachments !== 1)
        throw new ArkvoryError('invalid_input', 'The publish carries no tarball data');
      const facts = await this.inspector.inspect(this.staging.read(staged.id));
      checkDeclared(request.declared, facts);
      const manifest = parseNpmManifest(facts.manifest);
      if (manifest.name !== name || manifest.version !== request.version)
        throw new ArkvoryError('invalid_input', 'package.json names another package or version');
      const current = await this.reader.shasum(repository, name, request.version);
      if (current !== null) {
        if (current !== facts.sha1) throw versionExists();
        return { created: false };
      }
      const created = await this.storage.create(principal, repository, `npm-${facts.sha256}`, {
        name: npmTarballFile(name, request.version),
        size: String(facts.size),
        sha256: facts.sha256,
        labels: ['npm'],
        metadata: {},
      });
      if (created.status === 'cancelled')
        throw new ArkvoryError('conflict', 'This tarball was published and deleted', {
          reason: 'version_exists',
        });
      if (created.status === 'pending') {
        const bytes = this.staging.read(staged.id);
        await this.storage.upload(principal, repository, created.id, bytes, cancellation);
      }
      const version = npmVersionOf(facts, created.id);
      const added = await this.writer.addVersion(principal, repository, version, request.tags);
      // Another publish of this version won the race: the same tarball is still a success.
      if (!added.created && added.shasum !== facts.sha1) throw versionExists();
      return { created: added.created };
    } finally {
      await this.staging.remove(staged.id);
    }
  }
}

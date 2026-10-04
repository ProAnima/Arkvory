import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArtifactCatalog,
  ArtifactPromotion,
  MirrorFailure,
  StorageService,
} from '@proanima/arkvory-application';
import type {
  Cancellation,
  MirrorAnnotation,
  MirrorArtifact,
  MirrorAsset,
  MirrorSource,
  MirrorStage,
  MirrorTarget,
} from '@proanima/arkvory-application';
import { ArkvoryError, descriptorWire } from '@proanima/arkvory-domain';
import { MirrorRegistryRows } from './mirror-registry-rows.js';
import type { Principal, Upload } from '@proanima/arkvory-domain';
import {
  PostgresBrowse,
  PostgresLfsIndex,
  PostgresPromotions,
  PostgresRetention,
  PostgresStages,
  ZipManifestReader,
  reopenMirrorUpload,
} from '@proanima/arkvory-infrastructure';
import type {
  LocalBlobStore,
  PostgresCatalog,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';

const absent = (error: unknown) => error instanceof ArkvoryError && error.code === 'not_found';
async function* nothing(): AsyncIterable<Uint8Array> {}
const now = () => new Date().toISOString();

/** Writes one source range to `file` and returns its SHA-256; parts are hashed before upload. */
async function stagePart(content: AsyncIterable<Uint8Array>, file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(file, 'w', 0o600);
  try {
    for await (const chunk of content) {
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/**
 * The local mirrored repository (ADR 0058), changed through the same use cases as a client
 * would, by a service principal that only this worker holds: grants, validation, journal and
 * locks stay those of the product. Clients cannot write here (readOnlyRepositories in the API).
 */
export class ServiceMirrorTarget implements MirrorTarget {
  private readonly principal: Principal;
  private readonly browse: ArtifactCatalog;
  private readonly promotion: ArtifactPromotion;
  private readonly deletions: PostgresRetention;
  private readonly staging: string;
  private readonly registry: MirrorRegistryRows;
  private readonly lfs: PostgresLfsIndex;

  constructor(
    private readonly repository: string,
    private readonly catalog: PostgresCatalog,
    private readonly blobs: LocalBlobStore,
    dataDirectory: string,
    /** Owned by the caller, closed before the catalog: it holds its own database session. */
    pins: PostgresContentPins,
  ) {
    this.principal = {
      credential: 'file-key',
      id: `mirror:${repository}`,
      repositories: [repository],
      permissions: ['read', 'write'],
    };
    const storage = this.storage(randomUUID());
    const pool = catalog.pool;
    this.browse = new ArtifactCatalog(
      storage,
      new PostgresBrowse(pool),
      new ZipManifestReader(blobs, pins),
    );
    this.promotion = new ArtifactPromotion(
      storage,
      new PostgresStages(pool),
      new PostgresPromotions(pool, catalog, blobs),
      { next: randomUUID, now },
    );
    this.deletions = new PostgresRetention(pool);
    this.staging = join(dataDirectory, 'mirror-staging');
    this.registry = new MirrorRegistryRows(repository, pool, this.principal, storage);
    this.lfs = new PostgresLfsIndex(pool);
  }

  /** The copy keeps the source ID: the storage service of one artifact issues exactly it. */
  private storage(id: string): StorageService {
    return new StorageService(this.catalog, this.blobs, { next: () => id, now });
  }

  private async uploadOf(storage: StorageService, id: string): Promise<Upload | null> {
    try {
      return await storage.status(this.principal, this.repository, id);
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }

  async copy(
    artifact: MirrorArtifact,
    source: MirrorSource,
    c: Cancellation,
  ): Promise<number | null> {
    const { id, descriptor } = artifact;
    const storage = this.storage(id);
    const found = await this.uploadOf(storage, id);
    const upload =
      found ??
      (await storage.create(
        this.principal,
        this.repository,
        `mirror-${id}`,
        descriptorWire(descriptor),
      ));
    if (upload.status === 'available') {
      if (
        upload.descriptor.sha256 !== descriptor.sha256 ||
        upload.descriptor.size !== descriptor.size
      )
        throw new MirrorFailure('mirror_mismatch', 'A local artifact differs from the source');
      return 0;
    }
    // Expired while the source was away (cleanup may have cancelled it): continue it. Only a copy
    // that was published and then deleted here cannot be reopened.
    if (
      (upload.status === 'cancelled' || Date.parse(upload.expiresAt) <= Date.now()) &&
      !(await reopenMirrorUpload(this.catalog.pool, this.repository, id, this.principal.id))
    )
      // Deleted here after the source deleted it: a source restored from an older backup lists
      // it again. Failing would stop the seed for good; the deletion stands and it is skipped.
      return null;
    if (descriptor.size === 0) {
      await storage.upload(this.principal, this.repository, id, nothing(), c);
      return 0;
    }
    await this.copyParts(storage, artifact, source, c);
    try {
      await storage.complete(this.principal, this.repository, id, c);
    } catch (error) {
      // Parts that do not add up to the source SHA-256 are copied again by the next step.
      if (error instanceof ArkvoryError && error.code === 'integrity_mismatch')
        await reopenMirrorUpload(this.catalog.pool, this.repository, id, this.principal.id);
      throw error;
    }
    return descriptor.size;
  }

  private async copyParts(
    storage: StorageService,
    artifact: MirrorArtifact,
    source: MirrorSource,
    c: Cancellation,
  ): Promise<void> {
    const { id, descriptor } = artifact;
    const { partBytes, items } = await storage.parts(this.principal, this.repository, id);
    const recorded = new Set(items.map((part) => part.index));
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    for (let index = 0; index * partBytes < descriptor.size; index++) {
      if (recorded.has(index)) continue;
      c.throwIfAborted();
      const start = index * partBytes;
      const end = Math.min(descriptor.size, start + partBytes) - 1;
      const file = join(this.staging, `${id}.${String(index)}`);
      try {
        const sha256 = await stagePart(await source.content(artifact, start, end, c), file);
        await storage.uploadPart(
          this.principal,
          this.repository,
          id,
          index,
          sha256,
          createReadStream(file),
          c,
        );
      } finally {
        await rm(file, { force: true });
      }
    }
  }

  async remove(id: string): Promise<void> {
    let revision: number;
    try {
      revision = (await this.browse.annotation(this.principal, this.repository, id)).revision;
    } catch (error) {
      if (absent(error)) return;
      throw error;
    }
    // Gone on the source means its stages are gone too; local stages would protect the copy.
    await this.stages(id, []);
    // The deletion store, not the use case: clients delete with a managed key only, a policy for
    // people and services; this is the synchronization itself (tombstone and journal as usual).
    const [result] = await this.deletions.remove(
      { principal: this.principal, repository: this.repository, actions: ['artifact.delete'] },
      [{ id, expectedAnnotationRevision: revision }],
    );
    if (!result) throw new ArkvoryError('unavailable', 'Missing deletion result');
    if (result.outcome === 'protected' || result.outcome === 'not_eligible')
      throw new MirrorFailure('mirror_delete_blocked', 'The local copy cannot be deleted');
    if (result.outcome === 'changed')
      throw new ArkvoryError('conflict', 'The local copy changed during deletion', {
        reason: 'revision_mismatch',
      });
  }

  async annotate(id: string, value: MirrorAnnotation): Promise<void> {
    const current = await this.browse.annotation(this.principal, this.repository, id);
    const same =
      JSON.stringify([current.labels, current.metadata, current.collections]) ===
      JSON.stringify([value.labels, value.metadata, value.collections]);
    if (!same)
      await this.browse.annotate(this.principal, this.repository, id, current.revision, value);
  }

  async register(id: string): Promise<void> {
    await this.browse.register(this.principal, this.repository, id);
  }

  async local(id: string): Promise<'absent' | 'partial' | 'present' | 'deleted'> {
    const upload = await this.uploadOf(this.storage(id), id);
    if (!upload) return 'absent';
    if (upload.status === 'available') return 'present';
    if (upload.status === 'pending') return 'partial';
    // Cancelled by cleanup before the copy completed is unfinished, not deleted: copy reopens it.
    return (await reopenMirrorUpload(this.catalog.pool, this.repository, id, this.principal.id))
      ? 'partial'
      : 'deleted';
  }

  async adopt(
    id: string,
    annotation: MirrorAnnotation | null,
    stages: readonly MirrorStage[],
  ): Promise<void> {
    if (annotation) {
      // Revision 0: nobody here has edited the annotations yet, so the source's apply.
      const current = await this.browse.annotation(this.principal, this.repository, id);
      if (current.revision === 0)
        await this.browse.annotate(this.principal, this.repository, id, 0, annotation);
    }
    try {
      await this.browse.register(this.principal, this.repository, id);
    } catch (error) {
      // Not a UPack, or this installation has the identity from another artifact already.
      const skipped =
        error instanceof ArkvoryError &&
        (error.code === 'invalid_input' || error.reason === 'version_exists');
      if (!skipped) throw error;
    }
    const current = await this.promotion.stages(this.principal, this.repository, id);
    for (const { stage, comment } of stages)
      if (!current.some((entry) => entry.stage === stage))
        await this.promotion.setStage(this.principal, this.repository, id, stage, comment);
  }

  async stages(id: string, wanted: readonly MirrorStage[]): Promise<void> {
    const current = await this.promotion.stages(this.principal, this.repository, id);
    for (const { stage, comment } of wanted)
      if (!current.some((entry) => entry.stage === stage))
        await this.promotion.setStage(this.principal, this.repository, id, stage, comment);
    for (const { stage } of current)
      if (!wanted.some((entry) => entry.stage === stage))
        await this.promotion.removeStage(this.principal, this.repository, id, stage);
  }

  ociBlob(digest: string, artifactId: string): Promise<void> {
    return this.registry.blob(digest, artifactId);
  }
  ociManifest(image: string, artifactId: string, tag: string | null): Promise<void> {
    return this.registry.manifest(image, artifactId, tag);
  }
  ociUntag(image: string, tag: string): Promise<void> {
    return this.registry.untag(image, tag);
  }
  ociForget(image: string, digest: string): Promise<void> {
    return this.registry.forget(image, digest);
  }
  lfsObject(oid: string, artifactId: string): Promise<void> {
    return this.lfs.addObject(this.principal, this.repository, oid, artifactId);
  }
  npmVersion(artifactId: string): Promise<void> {
    return this.registry.npmVersion(artifactId);
  }
  npmTag(name: string, tag: string, version: string): Promise<void> {
    return this.registry.npmTag(name, tag, version);
  }
  npmUntag(name: string, tag: string): Promise<void> {
    return this.registry.npmUntag(name, tag);
  }

  async asset(asset: MirrorAsset): Promise<void> {
    let current: { revision: number; artifactId: string } | null = null;
    try {
      current = await this.browse.asset(this.principal, this.repository, asset.path);
    } catch (error) {
      if (!absent(error)) throw error;
    }
    if (current?.artifactId === asset.artifactId) return;
    await this.browse.setAsset(
      this.principal,
      this.repository,
      asset.path,
      asset.artifactId,
      current?.revision ?? 0,
    );
  }
}

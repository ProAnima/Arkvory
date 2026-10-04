import {
  ArkvoryError,
  OciError,
  authorizeAction,
  isOciTag,
  parseOciManifest,
} from '@proanima/arkvory-domain';
import type { OciManifestType, Principal } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type { StorageService } from './storage.js';

export interface OciManifestRecord {
  readonly digest: string;
  readonly artifactId: string;
  readonly mediaType: string;
}
export interface OciUploadState {
  readonly id: string;
  readonly repository: string;
  readonly image: string;
  readonly owner: string;
  readonly received: number;
}
/**
 * Registry rows over artifacts (ADR 0063). Blobs are per repository, manifests per image. Every
 * change is journaled in the repository feed with the actor, in its transaction, so mirrors
 * follow the registry like the rest of the catalog (ADR 0058).
 */
export interface OciIndex {
  blob(repository: string, digest: string): Promise<string | null>;
  /** Points the digest at the artifact that now holds it, replacing a vanished one. */
  addBlob(actor: Principal, repository: string, digest: string, artifactId: string): Promise<void>;
  /** By tag or by digest. */
  manifest(repository: string, image: string, reference: string): Promise<OciManifestRecord | null>;
  /**
   * Stores the manifest with the digests it references and, for a tag, points the tag at it, in
   * one transaction. References keep retention away from the blobs of a stored manifest; the
   * index refuses (MANIFEST_BLOB_UNKNOWN) when a reference or the manifest's own artifact is no
   * longer available at that moment.
   */
  putManifest(
    actor: Principal,
    repository: string,
    image: string,
    manifest: OciManifestRecord & { readonly references: readonly string[] },
    tag: string | null,
  ): Promise<void>;
  /** Removes the manifest, its references and the tags pointing at it; false when unknown. */
  deleteManifest(
    actor: Principal,
    repository: string,
    image: string,
    digest: string,
  ): Promise<boolean>;
  deleteTag(actor: Principal, repository: string, image: string, tag: string): Promise<boolean>;
  tags(repository: string, image: string, after: string | null, limit: number): Promise<string[]>;
  startUpload(state: OciUploadState): Promise<void>;
  upload(id: string): Promise<OciUploadState | null>;
  setReceived(id: string, received: number): Promise<void>;
  /**
   * Bytes `upload` may still stage: the repository quota and the installation capacity, less
   * the stored bytes and what other open uploads have staged. Staged bytes are not artifacts
   * yet; without this, abandoned sessions could fill the volume past every quota.
   */
  stagingRoom(repository: string, upload: string): Promise<number>;
  endUpload(id: string): Promise<void>;
  /** Forgets uploads idle for longer than `seconds` by the database clock; returns their ids. */
  expireUploads(seconds: number, limit: number): Promise<string[]>;
}
/** Bytes of uploads in progress; staging is never published content. */
export interface OciStaging {
  /**
   * Continues an upload at `offset`, dropping bytes past it that an interrupted request left.
   * Returns the new size; refuses to grow beyond `limit`.
   */
  append(
    id: string,
    offset: number,
    source: AsyncIterable<Uint8Array>,
    limit: number,
    cancellation: Cancellation,
  ): Promise<number>;
  read(id: string): AsyncIterable<Uint8Array>;
  /** Idempotent. */
  remove(id: string): Promise<void>;
  /** Removes staged files untouched for longer than `seconds`, also those without an upload. */
  prune(seconds: number): Promise<void>;
}

type Storage = Pick<StorageService, 'artifact' | 'cancel' | 'create' | 'download' | 'upload'>;
type UploadPath = { readonly repository: string; readonly image: string; readonly id: string };
const hex = (digest: string) => digest.slice('sha256:'.length);
/** An upload untouched for a day is abandoned; its staged bytes are removed. */
export const OCI_UPLOAD_IDLE_SECONDS = 24 * 60 * 60;
/** Bytes already in memory as the stream the artifact store reads; manifests are bounded. */
function stream(parts: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = parts.values();
      return { next: () => Promise.resolve(iterator.next()) };
    },
  };
}

/**
 * The container registry (ADR 0063): pulls and pushes of OCI images over ordinary artifacts, so
 * access, quota, integrity checks and backups are the catalog's own. Pull needs content.read
 * (and artifact.list for tags), push the upload actions; a read-only mirror refuses pushes.
 * One instance serves the single writer gateway: requests on one upload are serialized here.
 */
export class OciRegistry {
  private readonly busy = new Set<string>();
  constructor(
    private readonly storage: Storage,
    private readonly index: OciIndex,
    private readonly staging: OciStaging,
    private readonly ids: { next(): string },
    private readonly maxBlobBytes: number,
  ) {}

  /** The artifact holding a blob; unknown also when its artifact is no longer available. */
  async blob(principal: Principal, repository: string, digest: string) {
    authorizeAction(principal, repository, 'content.read', ['read']);
    const artifactId = await this.index.blob(repository, digest);
    const upload = artifactId ? await this.available(principal, repository, artifactId) : null;
    if (!artifactId || !upload) throw new OciError('BLOB_UNKNOWN', 'Blob unknown to registry');
    return { artifactId, size: upload.descriptor.size };
  }

  async manifest(principal: Principal, repository: string, image: string, reference: string) {
    authorizeAction(principal, repository, 'content.read', ['read']);
    const record = await this.index.manifest(repository, image, reference);
    if (!record || !(await this.available(principal, repository, record.artifactId)))
      throw new OciError('MANIFEST_UNKNOWN', 'Manifest unknown');
    const { read } = await this.storage.download(principal, repository, record.artifactId);
    const chunks: Uint8Array[] = [];
    for await (const chunk of read()) chunks.push(chunk);
    return { ...record, chunks };
  }

  async tags(
    principal: Principal,
    repository: string,
    image: string,
    after: string | null,
    limit: number,
  ) {
    authorizeAction(principal, repository, 'artifact.list', ['read']);
    return this.index.tags(repository, image, after, limit);
  }

  async startUpload(principal: Principal, repository: string, image: string): Promise<string> {
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const id = this.ids.next();
    await this.index.startUpload({ id, repository, image, owner: principal.id, received: 0 });
    return id;
  }

  /** An upload of this caller, repository and image; anything else is unknown. */
  async upload(principal: Principal, path: UploadPath) {
    authorizeAction(principal, path.repository, 'upload.write', ['write']);
    const state = await this.index.upload(path.id);
    if (
      !state ||
      state.owner !== principal.id ||
      state.repository !== path.repository ||
      state.image !== path.image
    )
      throw new OciError('BLOB_UPLOAD_UNKNOWN', 'Upload unknown');
    return state;
  }

  async append(
    principal: Principal,
    path: UploadPath,
    offset: number | undefined,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<number> {
    return this.exclusive(path.id, async () => {
      const state = await this.upload(principal, path);
      if (offset !== undefined && offset !== state.received)
        throw new OciError('BLOB_UPLOAD_INVALID', 'Chunk out of order', 416);
      const room = await this.index.stagingRoom(path.repository, state.id);
      const limit = Math.min(this.maxBlobBytes, state.received + room);
      const size = await this.staging
        .append(state.id, state.received, source, limit, cancellation)
        .catch((error: unknown) => {
          // The bound came from the quota or capacity, not from the blob size limit.
          if (
            limit < this.maxBlobBytes &&
            error instanceof OciError &&
            error.code === 'SIZE_INVALID'
          )
            throw new ArkvoryError(
              'capacity_exceeded',
              'Storage quota exceeded by staged uploads',
              {
                reason: 'storage_quota',
              },
            );
          throw error;
        });
      await this.index.setReceived(state.id, size);
      return size;
    });
  }

  /**
   * Completes an upload with its digest. The artifact store verifies the staged bytes against
   * it while it writes; a mismatch cancels that artifact. A blob the repository holds already
   * is not stored twice. A retry after a crash finds the artifact by the upload's key.
   */
  async finish(
    principal: Principal,
    path: UploadPath,
    digest: string,
    cancellation: Cancellation,
  ): Promise<void> {
    await this.exclusive(path.id, async () => {
      const state = await this.upload(principal, path);
      authorizeAction(principal, path.repository, 'upload.complete', ['write']);
      const known = await this.index.blob(path.repository, digest);
      if (!known || !(await this.available(principal, path.repository, known)))
        await this.storeBlob(principal, state, digest, cancellation);
      await this.staging.remove(state.id);
      await this.index.endUpload(state.id);
    });
  }

  async cancel(principal: Principal, path: UploadPath): Promise<void> {
    await this.exclusive(path.id, async () => {
      const state = await this.upload(principal, path);
      await this.staging.remove(state.id);
      await this.index.endUpload(state.id);
    });
  }

  /** Drops abandoned uploads with their bytes; staged files left by a crash age out too. */
  async expireUploads(limit = 100): Promise<number> {
    const expired = await this.index.expireUploads(OCI_UPLOAD_IDLE_SECONDS, limit);
    for (const id of expired) if (!this.busy.has(id)) await this.staging.remove(id);
    await this.staging.prune(OCI_UPLOAD_IDLE_SECONDS);
    return expired.length;
  }

  /**
   * Stores a manifest whose referenced blobs (image) or manifests (index) the repository holds.
   * `digest` is the SHA-256 of `bytes` as the HTTP adapter computed it; the artifact store
   * verifies it again. A digest reference must equal it; a tag reference moves the tag.
   */
  async putManifest(
    principal: Principal,
    target: { repository: string; image: string; reference: string },
    document: { bytes: Uint8Array; text: string; contentType: string | undefined; digest: string },
    cancellation: Cancellation,
  ): Promise<string> {
    const { repository, image, reference } = target;
    authorizeAction(principal, repository, 'upload.create', ['write']);
    const parsed = parseOciManifest(document.text, document.bytes.length, document.contentType);
    if (!isOciTag(reference) && reference !== document.digest)
      throw new OciError('DIGEST_INVALID', 'Manifest does not match the digest');
    for (const digest of parsed.blobs)
      if (!(await this.index.blob(repository, digest)))
        throw new OciError('MANIFEST_BLOB_UNKNOWN', `Blob ${digest} unknown to registry`);
    for (const digest of parsed.manifests)
      if (!(await this.index.manifest(repository, image, digest)))
        throw new OciError('MANIFEST_BLOB_UNKNOWN', `Manifest ${digest} unknown to registry`);
    const existing = await this.index.manifest(repository, image, document.digest);
    const artifactId =
      existing && (await this.available(principal, repository, existing.artifactId))
        ? existing.artifactId
        : await this.storeManifest(principal, target, document, parsed.mediaType, cancellation);
    await this.index.putManifest(
      principal,
      repository,
      image,
      {
        digest: document.digest,
        artifactId,
        mediaType: parsed.mediaType,
        references: [...parsed.blobs, ...parsed.manifests],
      },
      isOciTag(reference) ? reference : null,
    );
    return document.digest;
  }

  /**
   * By digest removes the manifest and every tag on it; by tag only the tag. The artifacts stay
   * until retention or an administrator removes them: nothing in the registry protects them.
   */
  async deleteManifest(principal: Principal, repository: string, image: string, reference: string) {
    authorizeAction(principal, repository, 'artifact.delete', null);
    const removed = isOciTag(reference)
      ? await this.index.deleteTag(principal, repository, image, reference)
      : await this.index.deleteManifest(principal, repository, image, reference);
    if (!removed) throw new OciError('MANIFEST_UNKNOWN', 'Manifest unknown');
  }

  private async storeBlob(
    principal: Principal,
    state: OciUploadState,
    digest: string,
    cancellation: Cancellation,
  ): Promise<void> {
    const created = await this.storage.create(principal, state.repository, `oci-${state.id}`, {
      name: digest,
      size: String(state.received),
      sha256: hex(digest),
      labels: ['oci'],
      metadata: { 'oci.kind': 'blob' },
    });
    if (created.status === 'cancelled')
      throw new OciError('DIGEST_INVALID', 'Content does not match the digest');
    if (created.status === 'pending')
      try {
        const source = this.staging.read(state.id);
        await this.storage.upload(principal, state.repository, created.id, source, cancellation);
      } catch (error) {
        if (!(error instanceof ArkvoryError) || error.code !== 'integrity_mismatch') throw error;
        await this.storage.cancel(principal, state.repository, created.id);
        throw new OciError('DIGEST_INVALID', 'Content does not match the digest');
      }
    await this.index.addBlob(principal, state.repository, digest, created.id);
  }

  private async storeManifest(
    principal: Principal,
    target: { repository: string; image: string },
    document: { bytes: Uint8Array; digest: string },
    mediaType: OciManifestType,
    cancellation: Cancellation,
  ): Promise<string> {
    const created = await this.storage.create(
      principal,
      target.repository,
      `oci-${this.ids.next()}`,
      {
        name: document.digest,
        size: String(document.bytes.length),
        sha256: hex(document.digest),
        labels: ['oci'],
        metadata: { 'oci.kind': 'manifest', 'oci.image': target.image, 'oci.mediaType': mediaType },
      },
    );
    const source = stream([document.bytes]);
    await this.storage.upload(principal, target.repository, created.id, source, cancellation);
    return created.id;
  }

  private async available(principal: Principal, repository: string, artifactId: string) {
    try {
      return await this.storage.artifact(principal, repository, artifactId, 'content.read');
    } catch (error) {
      if (error instanceof ArkvoryError && error.code === 'not_found') return null;
      throw error;
    }
  }

  private async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(id))
      throw new OciError('BLOB_UPLOAD_INVALID', 'Upload is in use by another request');
    this.busy.add(id);
    try {
      return await action();
    } finally {
      this.busy.delete(id);
    }
  }
}

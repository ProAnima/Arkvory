import type { StorageService } from '@proanima/arkvory-application';
import {
  MAX_OCI_MANIFEST_BYTES,
  OciError,
  isOciDigest,
  parseOciManifest,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { PostgresOciIndex } from '@proanima/arkvory-infrastructure';

/**
 * Registry rows of a mirrored repository (ADR 0063), written through the registry's own index:
 * locks, references and feed entries are those of a push, so a mirror of this mirror follows
 * the images too. The rows point at artifacts the synchronization has copied with source IDs.
 */
export class MirrorRegistryRows {
  private readonly index: PostgresOciIndex;
  constructor(
    private readonly repository: string,
    pool: ConstructorParameters<typeof PostgresOciIndex>[0],
    private readonly principal: Principal,
    private readonly storage: Pick<StorageService, 'download'>,
  ) {
    this.index = new PostgresOciIndex(pool);
  }

  async blob(digest: string, artifactId: string): Promise<void> {
    await this.index.addBlob(this.principal, this.repository, digest, artifactId);
  }

  /** The manifest held by the local artifact; its media type is the one stored at the push. */
  async manifest(image: string, artifactId: string, tag: string | null): Promise<void> {
    const { upload, read } = await this.storage.download(
      this.principal,
      this.repository,
      artifactId,
    );
    const { name: digest, size, metadata } = upload.descriptor;
    // Not a manifest of the registry: nothing to record (the feed names only manifests here).
    if (!isOciDigest(digest) || size > MAX_OCI_MANIFEST_BYTES) return;
    const chunks: Uint8Array[] = [];
    for await (const chunk of read()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const parsed = parseOciManifest(
      bytes.toString('utf8'),
      bytes.length,
      metadata['oci.mediaType'],
    );
    const references = [...parsed.blobs, ...parsed.manifests];
    try {
      await this.index.putManifest(
        this.principal,
        this.repository,
        image,
        { digest, artifactId, mediaType: parsed.mediaType, references },
        tag,
      );
    } catch (error) {
      // Content the source deleted after this manifest: a later feed entry deletes it here too.
      if (error instanceof OciError && error.code === 'MANIFEST_BLOB_UNKNOWN') return;
      throw error;
    }
  }

  async untag(image: string, tag: string): Promise<void> {
    await this.index.deleteTag(this.principal, this.repository, image, tag);
  }

  async forget(image: string, digest: string): Promise<void> {
    await this.index.deleteManifest(this.principal, this.repository, image, digest);
  }
}

import { ArkvoryError, requireAssetPath } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ArtifactCatalog } from './catalog.js';
import type { Cancellation } from './ports.js';
import type { StorageService } from './storage.js';

/** Bytes of a request that came without a checksum, hashed while staged; never published. */
export interface RawStaging {
  /** Stores the stream and returns its size and SHA-256; refuses to grow beyond `limit`. */
  stage(
    source: AsyncIterable<Uint8Array>,
    limit: number,
    cancellation: Cancellation,
  ): Promise<{ readonly id: string; readonly size: number; readonly sha256: string }>;
  read(id: string): AsyncIterable<Uint8Array>;
  /** Idempotent. */
  remove(id: string): Promise<void>;
}

export interface RawUpload {
  /** Content-Length; null for a chunked body (then the bytes are staged). */
  readonly size: number | null;
  /** The X-Checksum-Sha256 the client sent, lower case; null when absent. */
  readonly sha256: string | null;
  /** If-None-Match: * — only when the path does not exist yet. */
  readonly createOnly: boolean;
}
export interface RawFile {
  readonly path: string;
  readonly revision: number;
  readonly created: boolean;
  readonly artifact: { readonly id: string; readonly size: number; readonly sha256: string };
  /** False when the request body was not read (the path held these bytes already). */
  readonly consumed: boolean;
}
type Current = { revision: number; artifactId: string; size: number; sha256: string } | null;
type Storage = Pick<StorageService, 'artifact' | 'cancel' | 'create' | 'upload' | 'maxObjectBytes'>;

const absent = (error: unknown) => error instanceof ArkvoryError && error.code === 'not_found';
/** The artifact is named after the file; long or unusual names keep a neutral one. */
function fileName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.length <= 240 ? name : 'file';
}

/**
 * Raw files by path (ADR 0064): one request stores bytes as the new revision of a path. With a
 * checksum and a length the bytes stream straight into the artifact store, which verifies both;
 * otherwise they are staged and hashed first. The same bytes again add no revision, so a retried
 * CI step is idempotent. Two writers of one path race on the path revision: the later gets 409
 * revision_mismatch, and its artifact stays unnamed until retention removes it.
 */
export class RawFiles {
  constructor(
    private readonly storage: Storage,
    private readonly catalog: Pick<ArtifactCatalog, 'asset' | 'setAsset'>,
    private readonly staging: RawStaging,
    private readonly ids: { next(): string },
  ) {}

  async put(
    principal: Principal,
    repository: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    upload: RawUpload,
    cancellation: Cancellation,
  ): Promise<RawFile> {
    requireAssetPath(path);
    const current = await this.current(principal, repository, path);
    if (current && upload.createOnly)
      throw new ArkvoryError('conflict', 'The file path exists', { reason: 'already_exists' });
    if (upload.sha256 !== null && upload.size !== null) {
      const declared = { size: upload.size, sha256: upload.sha256 };
      if (same(current, declared)) return unchanged(path, current, false);
      return this.store(principal, repository, path, declared, source, current, cancellation);
    }
    const staged = await this.staging.stage(source, this.storage.maxObjectBytes, cancellation);
    try {
      if (upload.sha256 !== null && upload.sha256 !== staged.sha256)
        throw new ArkvoryError('integrity_mismatch', 'The body does not match X-Checksum-Sha256');
      if (same(current, staged)) return unchanged(path, current, true);
      const bytes = this.staging.read(staged.id);
      return await this.store(principal, repository, path, staged, bytes, current, cancellation);
    } finally {
      await this.staging.remove(staged.id);
    }
  }

  private async current(principal: Principal, repository: string, path: string) {
    try {
      const entry = await this.catalog.asset(principal, repository, path);
      const { descriptor } = await this.storage.artifact(
        principal,
        repository,
        entry.artifactId,
        'artifact.read',
      );
      return {
        revision: entry.revision,
        artifactId: entry.artifactId,
        size: descriptor.size,
        sha256: descriptor.sha256,
      };
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }

  private async store(
    principal: Principal,
    repository: string,
    path: string,
    content: { readonly size: number; readonly sha256: string },
    source: AsyncIterable<Uint8Array>,
    current: Current,
    cancellation: Cancellation,
  ): Promise<RawFile> {
    const created = await this.storage.create(principal, repository, `raw-${this.ids.next()}`, {
      name: fileName(path),
      size: String(content.size),
      sha256: content.sha256,
      labels: [],
      metadata: {},
    });
    try {
      await this.storage.upload(principal, repository, created.id, source, cancellation);
    } catch (error) {
      // Each request has its own key: a failed one would otherwise hold its size against the
      // quota until it expires, and a retrying client would reserve it again every attempt.
      await this.storage.cancel(principal, repository, created.id).catch(() => undefined);
      throw error;
    }
    const entry = await this.catalog.setAsset(
      principal,
      repository,
      path,
      created.id,
      current?.revision ?? 0,
    );
    return {
      path,
      revision: entry.revision,
      created: true,
      artifact: { id: created.id, size: content.size, sha256: content.sha256 },
      consumed: true,
    };
  }
}

function same(
  current: Current,
  content: { readonly size: number; readonly sha256: string },
): current is NonNullable<Current> {
  return current !== null && current.sha256 === content.sha256 && current.size === content.size;
}
function unchanged(path: string, current: NonNullable<Current>, consumed: boolean): RawFile {
  return {
    path,
    revision: current.revision,
    created: false,
    artifact: { id: current.artifactId, size: current.size, sha256: current.sha256 },
    consumed,
  };
}

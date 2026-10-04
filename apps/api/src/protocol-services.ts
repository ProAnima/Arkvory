import { randomUUID } from 'node:crypto';
import { GitLfs, NpmRegistry, OciRegistry, RawFiles } from '@proanima/arkvory-application';
import type { ArtifactCatalog, StorageService } from '@proanima/arkvory-application';
import {
  FileNpmPublishStaging,
  FileOciStaging,
  FileRawStaging,
  GzipNpmTarballInspector,
  PostgresLfsIndex,
  PostgresLfsLocks,
  PostgresNpmIndex,
  PostgresOciIndex,
} from '@proanima/arkvory-infrastructure';
import type { LocalBlobStore, PostgresCatalog } from '@proanima/arkvory-infrastructure';

/**
 * Services of the protocols beside /api/v1: raw files, Git LFS, npm and the image registry
 * (ADR 0063–0066). Their staging lives on the artifact volume, so its free-space reserve
 * covers staged bytes too; npm publishes stage like raw files.
 */
export function createProtocolServices(
  service: StorageService,
  browse: ArtifactCatalog,
  catalog: PostgresCatalog,
  blobs: LocalBlobStore,
  now: () => string,
) {
  const space = (bytes: number) => blobs.checkSpace(bytes);
  const rawStaging = new FileRawStaging(blobs.root, space);
  const ids = { next: randomUUID, now };
  const npmIndex = new PostgresNpmIndex(catalog.pool);
  return {
    rawStaging,
    raw: new RawFiles(service, browse, rawStaging, ids),
    lfs: new GitLfs(
      service,
      new PostgresLfsIndex(catalog.pool),
      new PostgresLfsLocks(catalog.pool),
      ids,
    ),
    npm: new NpmRegistry(
      service,
      new FileNpmPublishStaging(rawStaging),
      new GzipNpmTarballInspector(),
      npmIndex,
      npmIndex,
      ids,
    ),
    registry: new OciRegistry(
      service,
      new PostgresOciIndex(catalog.pool, catalog.capacityBytes),
      new FileOciStaging(blobs.root, space),
      ids,
      service.maxObjectBytes,
    ),
  };
}

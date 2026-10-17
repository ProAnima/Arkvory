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
import type { PostgresCatalog, StagingArea } from '@proanima/arkvory-infrastructure';

/**
 * Services of the protocols beside /api/v1: raw files, Git LFS, npm and the image registry
 * (ADR 0063–0066). Their staging lives in the staging area of the data volume, so its
 * free-space reserve covers staged bytes too; npm publishes stage like raw files.
 * They read and write content only through the storage service, never by path (ADR 0083, N9).
 */
export function createProtocolServices(
  service: StorageService,
  browse: ArtifactCatalog,
  catalog: PostgresCatalog,
  staging: StagingArea,
  now: () => string,
) {
  const rawStaging = new FileRawStaging(staging);
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
      new FileOciStaging(staging),
      ids,
      service.maxObjectBytes,
    ),
  };
}

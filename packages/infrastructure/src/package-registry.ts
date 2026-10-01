import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { PackageManifest } from '@proanima/arkvory-domain';
import type { PackageEntry } from '@proanima/arkvory-application';

/**
 * Registers the case-insensitive group/name/version identity inside the caller's catalog
 * transaction. Repeating the same artifact is idempotent; another artifact for an existing
 * identity is a conflict because published package versions are immutable.
 */
export async function insertPackage(
  client: PoolClient,
  repository: string,
  id: string,
  manifest: PackageManifest,
): Promise<PackageEntry> {
  const result = await client.query<{ artifact_id: string }>(
    `INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repository,lower(package_group),lower(name),lower(version)) DO UPDATE SET artifact_id=arkvory_packages.artifact_id RETURNING artifact_id`,
    [
      repository,
      manifest.group,
      manifest.name,
      manifest.version,
      id,
      JSON.stringify(manifest.original),
    ],
  );
  if (result.rows[0]?.artifact_id !== id)
    throw new ArkvoryError('conflict', 'Package version is immutable', {
      reason: 'version_exists',
    });
  return {
    group: manifest.group,
    name: manifest.name,
    version: manifest.version,
    artifactId: id,
    manifest: manifest.original,
  };
}

/** Exact version, or the highest SemVer key when version is omitted; only available artifacts. */
export async function resolvePackageArtifact(
  pool: Pool,
  repository: string,
  group: string,
  name: string,
  version: string | undefined,
): Promise<string | null> {
  const result = await pool.query<{ artifact_id: string }>(
    version === undefined
      ? `SELECT artifact_id FROM arkvory_packages WHERE repository=$1 AND EXISTS(SELECT 1 FROM arkvory_uploads u WHERE u.id=arkvory_packages.artifact_id AND u.status='available')
           AND lower(package_group COLLATE "C")=lower($2 COLLATE "C")
           AND lower(name COLLATE "C")=lower($3 COLLATE "C")
           ORDER BY arkvory_semver_key(version) COLLATE "C" DESC,
                    version COLLATE "C" ASC, artifact_id::text COLLATE "C" ASC LIMIT 1`
      : `SELECT artifact_id FROM arkvory_packages WHERE repository=$1 AND EXISTS(SELECT 1 FROM arkvory_uploads u WHERE u.id=arkvory_packages.artifact_id AND u.status='available')
           AND lower(package_group)=lower($2) AND lower(name)=lower($3)
           AND lower(version)=lower($4) LIMIT 1`,
    version === undefined ? [repository, group, name] : [repository, group, name, version],
  );
  return result.rows[0]?.artifact_id ?? null;
}

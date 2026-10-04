import type { Pool, PoolClient } from 'pg';
import { npmFeedActions } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type {
  NewNpmVersion,
  NpmIndexReader,
  NpmIndexWriter,
  NpmSearchItem,
  NpmVersionRow,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { lockCatalogMutation } from './catalog-mutation.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { storedCorrelation } from './request-correlation.js';

interface VersionRow {
  version: string;
  artifact_id: string;
  file: string;
  manifest: string;
  shasum: string;
  integrity: string;
  published_at: Date;
}
const available = `JOIN arkvory_uploads u ON u.id=v.artifact_id AND u.status='available'`;
/** $1 repository, $2 text: a part of the name or description, or a whole keyword. */
const matching = `v.repository=$1 AND ($2='' OR strpos(lower(v.name), lower($2))>0
  OR strpos(lower(coalesce(v.description,'')), lower($2))>0
  OR lower($2)=ANY(SELECT lower(k) FROM unnest(v.keywords) k))`;

function manifestOf(text: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(text);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
const rowOf = (row: VersionRow): NpmVersionRow => ({
  version: row.version,
  artifactId: row.artifact_id,
  file: row.file,
  manifest: manifestOf(row.manifest),
  shasum: row.shasum,
  integrity: row.integrity,
  publishedAt: row.published_at.toISOString(),
});
const tagDetail = (name: string, tag: string, version?: string) =>
  JSON.stringify(version === undefined ? { name, tag } : { name, tag, version });

/**
 * npm versions and dist-tags in PostgreSQL (ADR 0066). A change takes the repository's catalog
 * lock and journals itself in the same transaction, like the registry index (ADR 0063): mirrors
 * follow the feed in commit order, and retention, which deletes under that lock, sees the row.
 * Reads skip versions whose artifact is no longer available.
 */
export class PostgresNpmIndex implements NpmIndexReader, NpmIndexWriter {
  constructor(private readonly pool: Pool) {}

  async versions(repository: string, name: string): Promise<readonly NpmVersionRow[]> {
    const result = await this.pool.query<VersionRow>(
      `SELECT v.version, v.artifact_id::text, v.file, v.manifest, v.shasum, v.integrity,
              v.published_at
       FROM arkvory_npm_versions v ${available}
       WHERE v.repository=$1 AND v.name=$2 ORDER BY v.published_at, v.version`,
      [repository, name],
    );
    return result.rows.map(rowOf);
  }

  async tags(repository: string, name: string): Promise<Readonly<Record<string, string>>> {
    const result = await this.pool.query<{ tag: string; version: string }>(
      `SELECT t.tag, t.version FROM arkvory_npm_tags t
       JOIN arkvory_npm_versions v USING (repository, name, version) ${available}
       WHERE t.repository=$1 AND t.name=$2 ORDER BY t.tag`,
      [repository, name],
    );
    return Object.fromEntries(result.rows.map((row) => [row.tag, row.version]));
  }

  async tarball(repository: string, name: string, file: string): Promise<string | null> {
    const result = await this.pool.query<{ artifact_id: string }>(
      `SELECT v.artifact_id::text FROM arkvory_npm_versions v ${available}
       WHERE v.repository=$1 AND v.name=$2 AND v.file=$3`,
      [repository, name, file],
    );
    return result.rows[0]?.artifact_id ?? null;
  }

  async shasum(repository: string, name: string, version: string): Promise<string | null> {
    const result = await this.pool.query<{ shasum: string }>(
      `SELECT v.shasum FROM arkvory_npm_versions v ${available}
       WHERE v.repository=$1 AND v.name=$2 AND v.version=$3`,
      [repository, name, version],
    );
    return result.rows[0]?.shasum ?? null;
  }

  /** One row per package: its `latest` version, else the newest one; substring match. */
  async search(repository: string, text: string, from: number, size: number) {
    const [page, count] = await Promise.all([
      this.pool.query<{
        name: string;
        version: string;
        description: string | null;
        keywords: string[];
        published_at: Date;
      }>(
        `SELECT * FROM (
           SELECT DISTINCT ON (v.name) v.name, v.version, v.description, v.keywords,
             v.published_at
           FROM arkvory_npm_versions v ${available}
           LEFT JOIN arkvory_npm_tags t
             ON t.repository=v.repository AND t.name=v.name AND t.tag='latest'
           WHERE ${matching}
           ORDER BY v.name, (t.version IS NOT DISTINCT FROM v.version) DESC, v.published_at DESC
         ) best ORDER BY name OFFSET $3 LIMIT $4`,
        [repository, text, from, size],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(DISTINCT v.name)::text AS total FROM arkvory_npm_versions v ${available}
         WHERE ${matching}`,
        [repository, text],
      ),
    ]);
    const packages: NpmSearchItem[] = page.rows.map((row) => ({
      name: row.name,
      version: row.version,
      description: row.description,
      keywords: row.keywords,
      date: row.published_at.toISOString(),
    }));
    return { total: Number(count.rows[0]?.total ?? 0), packages };
  }

  async addVersion(
    actor: Principal,
    repository: string,
    version: NewNpmVersion,
    tags: readonly string[],
  ): Promise<{ readonly created: boolean; readonly shasum: string }> {
    return inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      // A row whose artifact is gone (deleted) gives way; a live version is never rewritten.
      const inserted = await client.query<{ shasum: string }>(
        `INSERT INTO arkvory_npm_versions AS v(repository,name,version,artifact_id,file,manifest,
           description,keywords,shasum,integrity)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (repository,name,version) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,
           file=EXCLUDED.file, manifest=EXCLUDED.manifest, description=EXCLUDED.description,
           keywords=EXCLUDED.keywords, shasum=EXCLUDED.shasum, integrity=EXCLUDED.integrity,
           published_at=now()
         WHERE NOT EXISTS (SELECT 1 FROM arkvory_uploads u
           WHERE u.id=v.artifact_id AND u.status='available')
         RETURNING v.shasum`,
        [
          repository,
          version.name,
          version.version,
          version.artifactId,
          version.file,
          JSON.stringify(version.manifest),
          version.description,
          version.keywords,
          version.shasum,
          version.integrity,
        ],
      );
      if (!inserted.rows[0]) {
        const held = await client.query<{ shasum: string }>(
          'SELECT shasum FROM arkvory_npm_versions WHERE repository=$1 AND name=$2 AND version=$3',
          [repository, version.name, version.version],
        );
        return { created: false, shasum: held.rows[0]?.shasum ?? '' };
      }
      const detail = JSON.stringify({ name: version.name, version: version.version });
      const audit: { action: string; detail: string }[] = [
        { action: npmFeedActions.version, detail },
      ];
      for (const tag of tags) {
        await this.upsertTag(client, repository, version.name, tag, version.version);
        audit.push({
          action: npmFeedActions.tag,
          detail: tagDetail(version.name, tag, version.version),
        });
      }
      await appendCatalogAudit(
        client,
        audit.map((row) => ({
          repository,
          artifactId: version.artifactId,
          actor: actor.id,
          ...row,
        })),
        storedCorrelation(actor.requestId),
      );
      return { created: true, shasum: version.shasum };
    });
  }

  async setTag(
    actor: Principal,
    repository: string,
    name: string,
    tag: string,
    version: string,
  ): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      const target = await client.query<{ artifact_id: string }>(
        `SELECT v.artifact_id::text FROM arkvory_npm_versions v ${available}
         WHERE v.repository=$1 AND v.name=$2 AND v.version=$3`,
        [repository, name, version],
      );
      const artifactId = target.rows[0]?.artifact_id;
      if (artifactId === undefined) return false;
      await this.upsertTag(client, repository, name, tag, version);
      await appendCatalogAudit(
        client,
        [
          {
            repository,
            artifactId,
            actor: actor.id,
            action: npmFeedActions.tag,
            detail: tagDetail(name, tag, version),
          },
        ],
        storedCorrelation(actor.requestId),
      );
      return true;
    });
  }

  async removeTag(actor: Principal, repository: string, name: string, tag: string) {
    return inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      const removed = await client.query<{ artifact_id: string }>(
        `DELETE FROM arkvory_npm_tags t USING arkvory_npm_versions v
         WHERE t.repository=$1 AND t.name=$2 AND t.tag=$3
           AND v.repository=t.repository AND v.name=t.name AND v.version=t.version
         RETURNING v.artifact_id::text`,
        [repository, name, tag],
      );
      const artifactId = removed.rows[0]?.artifact_id;
      if (artifactId === undefined) return false;
      await appendCatalogAudit(
        client,
        [
          {
            repository,
            artifactId,
            actor: actor.id,
            action: npmFeedActions.tagDeleted,
            detail: tagDetail(name, tag),
          },
        ],
        storedCorrelation(actor.requestId),
      );
      return true;
    });
  }

  private async upsertTag(
    client: PoolClient,
    repository: string,
    name: string,
    tag: string,
    version: string,
  ) {
    await client.query(
      `INSERT INTO arkvory_npm_tags(repository,name,tag,version) VALUES($1,$2,$3,$4)
       ON CONFLICT (repository,name,tag) DO UPDATE SET version=EXCLUDED.version`,
      [repository, name, tag, version],
    );
  }
}

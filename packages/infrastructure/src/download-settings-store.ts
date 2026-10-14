import type { Pool, PoolClient } from 'pg';
import type { DownloadOverrides } from '@proanima/arkvory-domain';
import type {
  DownloadSettingsAuthor,
  DownloadSettingsStore,
  StoredDownloadSettings,
} from '@proanima/arkvory-application';

/** Schema version of the download settings record (ADR 0076, stage 3). */
export const DOWNLOAD_SETTINGS_MIGRATION = 40;

export async function migrateDownloadSettings(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        DOWNLOAD_SETTINGS_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_download_settings(
      id smallint PRIMARY KEY CHECK (id = 1),
      revision bigint NOT NULL CHECK (revision > 0),
      overrides jsonb NOT NULL CHECK (octet_length(overrides::text) <= 4096),
      updated_by varchar(160) NOT NULL,
      actor varchar(160),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    DOWNLOAD_SETTINGS_MIGRATION,
  ]);
}

interface Row {
  revision: string;
  overrides: unknown;
  updated_by: string;
  actor: string | null;
  updated_at: Date;
}

const none: StoredDownloadSettings = {
  revision: 0,
  overrides: {},
  updatedAt: null,
  updatedBy: null,
  actor: null,
};

function stored(row: Row | undefined): StoredDownloadSettings {
  if (!row) return none;
  return {
    revision: Number(row.revision),
    // As stored: the application reads it leniently, so a row of a newer release or a hand edit
    // turns into a reported problem instead of a server that cannot start.
    overrides: row.overrides,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    actor: row.actor,
  };
}

/** One row, created by the first save; revision 0 means nothing was ever changed. */
export class PostgresDownloadSettings implements DownloadSettingsStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async read(): Promise<StoredDownloadSettings> {
    const found = await this.pool.query<Row>(
      'SELECT revision, overrides, updated_by, actor, updated_at FROM arkvory_download_settings WHERE id=1',
    );
    return stored(found.rows[0]);
  }

  async write(
    expectedRevision: number,
    overrides: DownloadOverrides,
    author: DownloadSettingsAuthor,
  ): Promise<StoredDownloadSettings | null> {
    // Each statement checks the revision and changes in one step: of two administrators saving
    // at once one wins and the other gets null. The first save creates the row.
    const values = [JSON.stringify(overrides), author.id, author.actor];
    const changed =
      expectedRevision === 0
        ? await this.pool.query<Row>(
            `INSERT INTO arkvory_download_settings(id, revision, overrides, updated_by, actor)
             VALUES (1, 1, $1::jsonb, $2, $3) ON CONFLICT (id) DO NOTHING
             RETURNING revision, overrides, updated_by, actor, updated_at`,
            values,
          )
        : await this.pool.query<Row>(
            `UPDATE arkvory_download_settings SET revision = revision + 1, overrides = $1::jsonb,
               updated_by = $2, actor = $3, updated_at = now()
             WHERE id = 1 AND revision = $4::bigint
             RETURNING revision, overrides, updated_by, actor, updated_at`,
            [...values, expectedRevision],
          );
    return changed.rows[0] ? stored(changed.rows[0]) : null;
  }
}

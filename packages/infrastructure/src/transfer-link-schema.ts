import type { PoolClient } from 'pg';

export const TRANSFER_LINK_MIGRATION = 29;

/**
 * Expand-only (ADR 0062): download links. Only the SHA-256 of a link's secret is kept; a link
 * names one artifact of one repository and lives at most a day. Rows are ephemeral and never
 * restored from a backup.
 */
export async function migrateTransferLinks(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        TRANSFER_LINK_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_transfer_links(
      id uuid PRIMARY KEY,
      token_hash char(64) NOT NULL UNIQUE,
      repository text NOT NULL,
      artifact_id uuid NOT NULL,
      issuer text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 day')
    )`);
  await client.query(
    'CREATE INDEX arkvory_transfer_links_issuer ON arkvory_transfer_links(issuer, expires_at)',
  );
  await client.query(
    'CREATE INDEX arkvory_transfer_links_expiry ON arkvory_transfer_links(expires_at)',
  );
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    TRANSFER_LINK_MIGRATION,
  ]);
}

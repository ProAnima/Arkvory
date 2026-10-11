import type { PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';

/*
 * Retained bytes per repository and upload status (ADR 0073). Capacity and quota checks read
 * this table instead of summing every upload ever stored. A trigger keeps it in the same
 * transaction as each change of an upload row, whichever code path makes it (uploads, publish,
 * cleanup, retention, mirrors, restore), so no caller maintains it by hand.
 *
 * A row counts its size under (repository, status) while it is not reclaimed. Within one row
 * change the old key is released before the new one is added in key order, so two transactions
 * changing single rows lock counter rows in the same order.
 */
const schema = `
  CREATE TABLE arkvory_upload_bytes(
    repository varchar(64) NOT NULL,
    status text NOT NULL,
    bytes bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(repository, status)
  );
  CREATE FUNCTION arkvory_add_upload_bytes(r varchar, s text, delta bigint) RETURNS void
  LANGUAGE sql AS $$
    INSERT INTO arkvory_upload_bytes(repository, status, bytes) VALUES (r, s, delta)
    ON CONFLICT (repository, status) DO UPDATE SET bytes = arkvory_upload_bytes.bytes + EXCLUDED.bytes
  $$;
  CREATE FUNCTION arkvory_count_upload_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    old_counts boolean := false;
    new_counts boolean := false;
  BEGIN
    -- OLD is unset on INSERT and NEW on DELETE: read each only for the operations that have it.
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      old_counts := NOT OLD.reclaimed;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
      new_counts := NOT NEW.reclaimed;
    END IF;
    IF old_counts AND new_counts THEN
      IF OLD.repository = NEW.repository AND OLD.status = NEW.status THEN
        IF OLD.size <> NEW.size THEN
          PERFORM arkvory_add_upload_bytes(NEW.repository, NEW.status, NEW.size - OLD.size);
        END IF;
      ELSIF (NEW.repository, NEW.status) < (OLD.repository, OLD.status) THEN
        PERFORM arkvory_add_upload_bytes(NEW.repository, NEW.status, NEW.size);
        PERFORM arkvory_add_upload_bytes(OLD.repository, OLD.status, -OLD.size);
      ELSE
        PERFORM arkvory_add_upload_bytes(OLD.repository, OLD.status, -OLD.size);
        PERFORM arkvory_add_upload_bytes(NEW.repository, NEW.status, NEW.size);
      END IF;
    ELSIF old_counts THEN
      PERFORM arkvory_add_upload_bytes(OLD.repository, OLD.status, -OLD.size);
    ELSIF new_counts THEN
      PERFORM arkvory_add_upload_bytes(NEW.repository, NEW.status, NEW.size);
    END IF;
    RETURN NULL;
  END $$;
`;

/** Recounts the table from the uploads; the caller holds a lock that excludes upload writes. */
export const recountUploadBytes = `
  DELETE FROM arkvory_upload_bytes;
  INSERT INTO arkvory_upload_bytes(repository, status, bytes)
  SELECT repository, status, sum(size) FROM arkvory_uploads WHERE NOT reclaimed
  GROUP BY repository, status;
`;

/** Version 35. Blocks upload writes while it counts once; a rolling update waits for it. */
export async function migrateUploadBytes(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=35')).rowCount)
    return;
  await client.query(`
    LOCK TABLE arkvory_uploads IN SHARE ROW EXCLUSIVE MODE;
    ${schema}
    CREATE TRIGGER arkvory_count_upload_bytes
      AFTER INSERT OR DELETE OR UPDATE OF size, status, reclaimed, repository ON arkvory_uploads
      FOR EACH ROW EXECUTE FUNCTION arkvory_count_upload_bytes();
    ${recountUploadBytes}
    INSERT INTO arkvory_migrations(version) VALUES(35);
  `);
}

/** Retained bytes of all repositories, or of one, as SQL (a small table, any number of uploads). */
export const reservedBytesSql = 'SELECT COALESCE(sum(bytes),0) FROM arkvory_upload_bytes';

/** Serializes reservations, never byte transfers: held while room is checked and taken. */
export async function lockReservations(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(18471, 2)');
}

/**
 * Refuses `size` more retained bytes beyond the installation's capacity or the repository's
 * quota. The caller holds the reservation lock until it has counted them.
 */
export async function requireRoom(
  client: PoolClient,
  repository: string,
  size: number,
  capacityBytes: number,
): Promise<void> {
  const totals = await client.query<{ bytes: string }>(
    `SELECT (${reservedBytesSql})::text AS bytes`,
  );
  const total = totals.rows[0];
  if (!total || BigInt(total.bytes) + BigInt(size) > BigInt(capacityBytes))
    throw new ArkvoryError('capacity_exceeded', 'Catalog capacity exceeded', {
      reason: 'catalog_limit',
    });
  const quota = (
    await client.query<{ quota: string | null; used: string }>(
      `SELECT p.policy->>'quotaBytes' AS quota,
        (${reservedBytesSql} WHERE repository=$1)::text AS used
       FROM arkvory_storage_policies p WHERE p.repository=$1`,
      [repository],
    )
  ).rows[0];
  if (quota?.quota && BigInt(quota.used) + BigInt(size) > BigInt(quota.quota))
    throw new ArkvoryError('capacity_exceeded', 'Repository storage quota exceeded', {
      reason: 'storage_quota',
    });
}

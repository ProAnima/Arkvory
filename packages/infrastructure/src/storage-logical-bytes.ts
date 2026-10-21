import type { PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';

export function logicalLimit(value: unknown): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new ArkvoryError('unavailable', 'Invalid storage logical byte limit');
  const limit = BigInt(value);
  if (limit > 18446744073709551615n)
    throw new ArkvoryError('unavailable', 'Invalid storage logical byte limit');
  return limit;
}

/** Called under lockReservations, before inserting the new upload in the same transaction. */
export async function limitedBackend(
  client: PoolClient,
  backend: string,
  size: number,
  limitOf: (backend: string) => string | null,
): Promise<string> {
  if (backend === 'default') return backend;
  const limit = logicalLimit(limitOf(backend));
  if (limit === null) return backend;
  const result = await client.query<{ bytes: string }>(
    'SELECT bytes::text AS bytes FROM arkvory_backend_bytes WHERE backend=$1',
    [backend],
  );
  const used = BigInt(result.rows[0]?.bytes ?? '0');
  return used + BigInt(size) <= limit ? backend : 'default';
}

/** Additive accounting, also maintained by older writers through the database trigger. */
export async function migrateBackendBytes(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM arkvory_migrations WHERE version=51')).rowCount) return;
  await client.query(`
    LOCK TABLE arkvory_uploads IN SHARE ROW EXCLUSIVE MODE;
    CREATE TABLE IF NOT EXISTS arkvory_backend_bytes (
      backend text PRIMARY KEY,
      bytes numeric NOT NULL CHECK(bytes>=0 AND bytes=trunc(bytes))
    );
    DELETE FROM arkvory_backend_bytes;
    INSERT INTO arkvory_backend_bytes
      SELECT storage_backend, sum(size) FROM arkvory_uploads WHERE NOT reclaimed
      GROUP BY storage_backend;
    CREATE OR REPLACE FUNCTION arkvory_add_backend_bytes(b text, delta numeric) RETURNS void
    LANGUAGE sql AS $$
      INSERT INTO arkvory_backend_bytes(backend,bytes) VALUES(b,0) ON CONFLICT DO NOTHING;
      UPDATE arkvory_backend_bytes SET bytes=bytes+delta WHERE backend=b
    $$;
    CREATE OR REPLACE FUNCTION arkvory_count_backend_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      old_backend text := NULL; new_backend text := NULL;
      old_bytes numeric := 0; new_bytes numeric := 0;
    BEGIN
      IF TG_OP IN ('UPDATE','DELETE') THEN
        IF NOT OLD.reclaimed THEN old_backend:=OLD.storage_backend; old_bytes:=OLD.size; END IF;
      END IF;
      IF TG_OP IN ('INSERT','UPDATE') THEN
        IF NOT NEW.reclaimed THEN new_backend:=NEW.storage_backend; new_bytes:=NEW.size; END IF;
      END IF;
      IF old_backend IS NOT DISTINCT FROM new_backend THEN
        IF old_backend IS NOT NULL AND old_bytes<>new_bytes THEN
          PERFORM arkvory_add_backend_bytes(old_backend,new_bytes-old_bytes);
        END IF;
      ELSE
        -- Stable row-lock order also covers future moves between non-default backends.
        IF old_backend IS NOT NULL AND (new_backend IS NULL OR old_backend<new_backend) THEN
          PERFORM arkvory_add_backend_bytes(old_backend,-old_bytes);
        END IF;
        IF new_backend IS NOT NULL THEN PERFORM arkvory_add_backend_bytes(new_backend,new_bytes); END IF;
        IF old_backend IS NOT NULL AND new_backend IS NOT NULL AND old_backend>=new_backend THEN
          PERFORM arkvory_add_backend_bytes(old_backend,-old_bytes);
        END IF;
      END IF;
      RETURN NULL;
    END $$;
    DROP TRIGGER IF EXISTS arkvory_count_backend_bytes ON arkvory_uploads;
    CREATE TRIGGER arkvory_count_backend_bytes
      AFTER INSERT OR DELETE OR UPDATE OF size, storage_backend, reclaimed ON arkvory_uploads
      FOR EACH ROW EXECUTE FUNCTION arkvory_count_backend_bytes();
    INSERT INTO arkvory_migrations(version) VALUES(51);
  `);
}

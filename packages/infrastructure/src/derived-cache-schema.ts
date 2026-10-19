import type { PoolClient } from 'pg';

export const DERIVED_CACHE_MIGRATION = 49;

/** Expand-only. Reservations survive owner loss and every intermediate cleanup state.
 * The adapter serializes admission with the existing module-data coordinator lock;
 * bounded per-module generation counts make reservation SUM independent of file counts.
 */
export async function migrateDerivedCache(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT 1 FROM arkvory_migrations WHERE version=$1', [
        DERIVED_CACHE_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_derived_cache_owners (
      id uuid PRIMARY KEY,
      quiescent boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      quiescent_at timestamptz
    );
    CREATE TABLE arkvory_derived_cache_entries (
      module_id varchar(32) NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9-]{0,31}$'),
      key text NOT NULL CHECK (octet_length(key) BETWEEN 1 AND 256),
      current_id uuid,
      building_id uuid,
      fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
      last_access timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (module_id,key)
    );
    CREATE TABLE arkvory_derived_cache_generations (
      id uuid PRIMARY KEY,
      module_id varchar(32) NOT NULL,
      key text NOT NULL,
      owner_id uuid NOT NULL REFERENCES arkvory_derived_cache_owners(id),
      fence bigint NOT NULL CHECK (fence > 0),
      state text NOT NULL CHECK (state IN ('building','ready','retired','deleting')),
      reserve_bytes bigint NOT NULL CHECK (reserve_bytes BETWEEN 0 AND 9007199254740991),
      reserve_files integer NOT NULL CHECK (reserve_files BETWEEN 0 AND 4096),
      actual_bytes bigint NOT NULL DEFAULT 0 CHECK (actual_bytes >= 0 AND actual_bytes <= reserve_bytes),
      actual_files integer NOT NULL DEFAULT 0 CHECK (actual_files >= 0 AND actual_files <= reserve_files),
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      manifest_hash char(64) CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
      io_quiescent boolean NOT NULL DEFAULT false,
      CHECK (state <> 'ready' OR manifest_hash IS NOT NULL),
      retired_at timestamptz,
      UNIQUE (module_id,key,id),
      FOREIGN KEY (module_id,key) REFERENCES arkvory_derived_cache_entries(module_id,key)
    );
    -- Persist reader ownership beyond PG-session loss: an OS handle may still be open.
    -- No cascading deletes: refs are released only after drain or confirmed quiescence.
    CREATE TABLE arkvory_derived_cache_read_refs (
      id uuid PRIMARY KEY,
      generation_id uuid NOT NULL REFERENCES arkvory_derived_cache_generations(id),
      owner_id uuid NOT NULL REFERENCES arkvory_derived_cache_owners(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX arkvory_derived_cache_generation_readers
      ON arkvory_derived_cache_read_refs(generation_id,owner_id);
    CREATE INDEX arkvory_derived_cache_owner_reads
      ON arkvory_derived_cache_read_refs(owner_id,id);
    ALTER TABLE arkvory_derived_cache_entries
      ADD FOREIGN KEY (module_id,key,current_id)
        REFERENCES arkvory_derived_cache_generations(module_id,key,id),
      ADD FOREIGN KEY (module_id,key,building_id)
        REFERENCES arkvory_derived_cache_generations(module_id,key,id);
    CREATE INDEX arkvory_derived_cache_owner_generations
      ON arkvory_derived_cache_generations(owner_id,module_id,state,id);
    CREATE INDEX arkvory_derived_cache_module_state
      ON arkvory_derived_cache_generations(module_id,state,id);
    CREATE INDEX arkvory_derived_cache_eviction
      ON arkvory_derived_cache_entries(module_id,last_access,key)
      WHERE current_id IS NOT NULL;
  `);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    DERIVED_CACHE_MIGRATION,
  ]);
}

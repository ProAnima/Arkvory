import type { PoolClient } from 'pg';

export async function migrateResourceCatalog(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM arkvory_migrations WHERE version=52')).rowCount) return;
  await client.query(`
    CREATE TABLE arkvory_module_resource_catalogs (
      module_id varchar(32) PRIMARY KEY,
      ready boolean NOT NULL DEFAULT false
    );
    CREATE TABLE arkvory_module_resources (
      module_id varchar(32) NOT NULL,
      key varchar(256) NOT NULL,
      state text NOT NULL DEFAULT 'live' CHECK(state IN ('live','doomed')),
      generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
      canonical_name text,
      unclaimed_at timestamptz,
      PRIMARY KEY(module_id,key)
    );
    CREATE INDEX arkvory_module_resources_gc
      ON arkvory_module_resources(module_id,unclaimed_at,key) WHERE unclaimed_at IS NOT NULL;
    CREATE TABLE arkvory_module_resource_owners (
      module_id varchar(32) NOT NULL,
      owner varchar(256) NOT NULL,
      closed boolean NOT NULL DEFAULT false,
      PRIMARY KEY(module_id,owner)
    );
    CREATE TABLE arkvory_module_resource_refs (
      module_id varchar(32) NOT NULL,
      owner varchar(256) NOT NULL,
      key varchar(256) NOT NULL,
      PRIMARY KEY(module_id,owner,key),
      FOREIGN KEY(module_id,owner) REFERENCES arkvory_module_resource_owners,
      FOREIGN KEY(module_id,key) REFERENCES arkvory_module_resources
    );
    CREATE INDEX arkvory_module_resource_refs_key ON arkvory_module_resource_refs(module_id,key);
    CREATE TABLE arkvory_module_resource_files (
      module_id varchar(32) NOT NULL,
      key varchar(256) NOT NULL,
      name text NOT NULL CHECK(octet_length(name)<=1024),
      metadata bytea NOT NULL CHECK(octet_length(metadata)<=8192),
      sources text[] NOT NULL CHECK(cardinality(sources)<=1024),
      ready boolean NOT NULL DEFAULT false,
      PRIMARY KEY(module_id,name),
      FOREIGN KEY(module_id,key) REFERENCES arkvory_module_resources
    );
    CREATE INDEX arkvory_module_resource_files_key ON arkvory_module_resource_files(module_id,key,name);
    CREATE TABLE arkvory_module_resource_edges (
      module_id varchar(32) NOT NULL,
      key varchar(256) NOT NULL,
      source varchar(256) NOT NULL,
      PRIMARY KEY(module_id,key,source),
      FOREIGN KEY(module_id,key) REFERENCES arkvory_module_resources,
      FOREIGN KEY(module_id,source) REFERENCES arkvory_module_resources,
      CHECK(key<>source)
    );
    CREATE INDEX arkvory_module_resource_edges_source ON arkvory_module_resource_edges(module_id,source);
    INSERT INTO arkvory_migrations(version) VALUES(52);
  `);
}

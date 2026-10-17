import type { Pool, PoolClient } from 'pg';
import {
  ArkvoryError,
  parsePlacementRules,
  placementRulesWire,
  requireId,
} from '@proanima/arkvory-domain';
import type { MutationAccess, StorageRoutingRule } from '@proanima/arkvory-domain';
import type { PlacementPolicies, PlacementPolicy } from '@proanima/arkvory-application';
import { lockServiceAccess } from './service-authorization.js';
import { lockCatalogMutation } from './catalog-mutation.js';
import { recordStorageEvent } from './storage-events.js';
import type { StorageIdentityRecords } from './storage-backend-probe.js';

/**
 * Version 44 (ADR 0083, N11), expand-only: the placement policy of each repository (part of a
 * backup), the identity each storage other than `default` had when first opened (not part of a
 * backup: a restore writes new storages), and where the parts of an upload stayed when it was
 * finished in another storage (NULL: in `storage_backend`).
 */
export async function migrateStoragePlacement(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=44')).rowCount)
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_storage_placement (
      repository text PRIMARY KEY,
      revision integer NOT NULL CHECK (revision > 0),
      rules jsonb NOT NULL,
      updated_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arkvory_storage_backends (
      backend_id varchar(64) PRIMARY KEY,
      storage_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE arkvory_uploads ADD COLUMN IF NOT EXISTS parts_backend varchar(64);
    INSERT INTO arkvory_migrations(version) VALUES(44);
  `);
}

interface Row {
  revision: number;
  rules: unknown;
  updated_by: string;
  updated_at: Date;
}

export class PostgresPlacementPolicies implements PlacementPolicies {
  constructor(private readonly pool: Pool) {}

  async get(repository: string): Promise<PlacementPolicy> {
    const row = (
      await this.pool.query<Row>(
        'SELECT revision,rules,updated_by,updated_at FROM arkvory_storage_placement WHERE repository=$1',
        [repository],
      )
    ).rows[0];
    return {
      repository,
      revision: row?.revision ?? 0,
      rules: row ? parsePlacementRules(row.rules) : [],
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at.toISOString() ?? null,
    };
  }

  async save(
    access: MutationAccess,
    expectedRevision: number,
    rules: readonly StorageRoutingRule[],
  ): Promise<PlacementPolicy> {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query('BEGIN');
      await lockServiceAccess(c, access);
      await lockCatalogMutation(c, access.repository);
      const row = (
        await c.query<{ revision: number }>(
          'SELECT revision FROM arkvory_storage_placement WHERE repository=$1 FOR UPDATE',
          [access.repository],
        )
      ).rows[0];
      if ((row?.revision ?? 0) !== expectedRevision || expectedRevision === 2147483647)
        throw new ArkvoryError('conflict', 'Storage placement changed', {
          reason: 'revision_mismatch',
        });
      await c.query(
        `INSERT INTO arkvory_storage_placement(repository,revision,rules,updated_by) VALUES($1,1,$2,$3)
        ON CONFLICT(repository) DO UPDATE SET revision=arkvory_storage_placement.revision+1,
        rules=$2,updated_by=$3,updated_at=now()`,
        [access.repository, JSON.stringify(placementRulesWire(rules)), access.principal.id],
      );
      await recordStorageEvent(c, access.repository, 'info', 'storage.placement_updated', {
        actor: access.principal.id,
        revision: expectedRevision + 1,
        rules: rules.length,
      });
      await c.query('COMMIT');
    } catch (error) {
      try {
        await c.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      c.release(broken);
    }
    return this.get(access.repository);
  }
}

export class PostgresStorageIdentities implements StorageIdentityRecords {
  constructor(private readonly pool: Pool) {}

  async recorded(backendId: string): Promise<string | null> {
    const row = (
      await this.pool.query<{ storage_id: string }>(
        'SELECT storage_id FROM arkvory_storage_backends WHERE backend_id=$1',
        [backendId],
      )
    ).rows[0];
    return row?.storage_id ?? null;
  }

  async record(backendId: string, storageId: string): Promise<string> {
    // Two writers starting together both insert; the first identity wins and the other sees it.
    await this.pool.query(
      'INSERT INTO arkvory_storage_backends(backend_id,storage_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [backendId, requireId(storageId)],
    );
    const recorded = await this.recorded(backendId);
    if (recorded === null) throw new ArkvoryError('unavailable', 'Storage identity not recorded');
    return recorded;
  }
}

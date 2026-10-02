import { BackupFailure } from '@proanima/arkvory-domain';
import type { ExcludedTable } from '@proanima/arkvory-domain';

export interface BackupTable {
  readonly name: string;
  /** Primary key: stable export order and the match key of deferred updates. */
  readonly key: readonly string[];
  /** Self-references, loaded as NULL first and set once the whole table exists. */
  readonly deferred?: readonly string[];
}

/** Oldest schema whose tables and normalization this release can restore (ADR 0054). */
export const MINIMUM_RESTORE_SCHEMA = 25;

/**
 * Every Arkvory table of schema 25 is either exported here, in foreign-key-safe load order, or
 * excluded below with a reason. A migration that adds a table must extend one of the lists;
 * capture refuses an unlisted table and tests compare both lists with a migrated database.
 */
export const exportedTables: readonly BackupTable[] = [
  { name: 'arkvory_users', key: ['id'] },
  { name: 'arkvory_access_groups', key: ['id'] },
  { name: 'arkvory_group_members', key: ['group_id', 'user_id'] },
  { name: 'arkvory_group_grants', key: ['group_id', 'repository'] },
  { name: 'arkvory_user_tokens', key: ['id'] },
  { name: 'arkvory_service_accounts', key: ['id'] },
  { name: 'arkvory_api_keys', key: ['id'], deferred: ['rotated_from', 'issued_via_key_id'] },
  { name: 'arkvory_service_delegations', key: ['key_id', 'target_account_id'] },
  { name: 'arkvory_service_audit', key: ['sequence'] },
  { name: 'arkvory_uploads', key: ['id'] },
  { name: 'arkvory_parts', key: ['upload_id', 'part_index'] },
  { name: 'arkvory_annotations', key: ['artifact_id'] },
  { name: 'arkvory_packages', key: ['repository', 'package_group', 'name', 'version'] },
  { name: 'arkvory_assets', key: ['repository', 'path'] },
  {
    name: 'arkvory_asset_revisions',
    key: ['repository', 'path', 'revision'],
    deferred: ['source_revision'],
  },
  { name: 'arkvory_references', key: ['repository', 'artifact_id', 'owner', 'reference'] },
  { name: 'arkvory_audit', key: ['sequence'] },
  { name: 'arkvory_jobs', key: ['id'] },
  { name: 'arkvory_attachment_revisions', key: ['artifact_id', 'revision'] },
  { name: 'arkvory_attachment_targets', key: ['parent_id', 'revision', 'target_id'] },
  { name: 'arkvory_artifact_deletions', key: ['artifact_id'] },
  { name: 'arkvory_storage_policies', key: ['repository'] },
  { name: 'arkvory_storage_events', key: ['sequence'] },
  { name: 'arkvory_cleanup_settings', key: ['repository'] },
  { name: 'arkvory_artifact_stages', key: ['repository', 'artifact_id', 'stage'] },
  { name: 'arkvory_promotion_events', key: ['sequence'] },
  { name: 'arkvory_promotions', key: ['target_artifact_id'] },
  { name: 'arkvory_security_audit', key: ['id'] },
];

export const excludedTables: readonly ExcludedTable[] = [
  { name: 'arkvory_migrations', reason: 'schema history; restore migrates the target itself' },
  { name: 'arkvory_storage_identity', reason: 'bound to the new target storage directory' },
  { name: 'arkvory_user_sessions', reason: 'ephemeral sign-in sessions are never restored' },
  { name: 'arkvory_gateway_leases', reason: 'runtime ownership of gateway slots' },
  { name: 'arkvory_download_policy', reason: 'gateway topology is configured on the target' },
  { name: 'arkvory_backup_jobs', reason: 'backup state of the source instance' },
  { name: 'arkvory_backup_pins', reason: 'backup state of the source instance' },
  { name: 'arkvory_backup_barrier', reason: 'backup state of the source instance' },
];

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;

/** Double-quoted SQL identifier of a registry or catalog name; anything else is refused. */
export function quoteIdentifier(name: string): string {
  if (!identifier.test(name)) throw new BackupFailure('unexpected', 'Unsafe SQL identifier');
  return `"${name}"`;
}

export function exportedTable(name: string): BackupTable {
  const table = exportedTables.find((candidate) => candidate.name === name);
  if (!table) throw new BackupFailure('unknown_table', 'Table is not exported by this release');
  return table;
}

/** Arkvory tables of a database that the registry neither exports nor excludes. */
export function unregisteredTables(present: readonly string[]): readonly string[] {
  const known = new Set([...exportedTables, ...excludedTables].map((table) => table.name));
  return present.filter((name) => !known.has(name)).sort();
}

/** Catalog query of the Arkvory tables in the current schema (search_path). */
export const presentTablesQuery = `SELECT c.relname AS name FROM pg_class c
  WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind IN ('r','p')
  AND c.relname LIKE 'arkvory\\_%' ORDER BY c.relname`;

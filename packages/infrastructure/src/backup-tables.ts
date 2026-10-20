import { BackupFailure } from '@proanima/arkvory-domain';
import type { ExcludedTable } from '@proanima/arkvory-domain';

export interface BackupTable {
  readonly name: string;
  /** Primary key: stable export order and the match key of deferred updates. */
  readonly key: readonly string[];
  /** Self-references, loaded as NULL first and set once the whole table exists. */
  readonly deferred?: readonly string[];
  /** The schema that created the table; absent means it existed at MINIMUM_RESTORE_SCHEMA. */
  readonly since?: number;
}

/** Oldest schema whose tables and normalization this release can restore (ADR 0054). */
export const MINIMUM_RESTORE_SCHEMA = 25;

/**
 * Every Arkvory table of the current schema is either exported here, in foreign-key-safe load order, or
 * excluded below with a reason. A migration that adds a table must extend one of the lists;
 * capture refuses an unlisted table and tests compare both lists with a migrated database.
 */
export const exportedTables: readonly BackupTable[] = [
  { name: 'arkvory_module_cursors', key: ['module_id', 'consumer'], since: 48 },
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
  // The feed cursor belongs to the mirrored data: restored together, the mirror continues.
  { name: 'arkvory_mirror_state', key: ['repository'], since: 28 },
  // Versions an import took over: with the catalog, so a restored import does not repeat them.
  { name: 'arkvory_mirror_adoptions', key: ['repository', 'artifact_id'], since: 37 },
  // Entries put aside behind the restored cursor: without them they would be passed for good.
  { name: 'arkvory_mirror_conflicts', key: ['repository', 'artifact_id', 'entry'], since: 41 },
  // The container registry rows name artifacts restored above (ADR 0063).
  { name: 'arkvory_oci_blobs', key: ['repository', 'digest'], since: 30 },
  { name: 'arkvory_oci_manifests', key: ['repository', 'image', 'digest'], since: 30 },
  { name: 'arkvory_oci_tags', key: ['repository', 'image', 'tag'], since: 30 },
  {
    name: 'arkvory_oci_references',
    key: ['repository', 'image', 'manifest', 'target'],
    since: 30,
  },
  // Git LFS objects name artifacts restored above; locks are the team's coordination (ADR 0065).
  { name: 'arkvory_lfs_objects', key: ['repository', 'oid'], since: 31 },
  { name: 'arkvory_lfs_locks', key: ['id'], since: 31 },
  { name: 'arkvory_npm_versions', key: ['repository', 'name', 'version'], since: 32 },
  { name: 'arkvory_npm_tags', key: ['repository', 'name', 'tag'], since: 32 },
  // The delivery cursor belongs to the feed it follows: restored together, no event repeats or is lost.
  { name: 'arkvory_webhook_state', key: ['subscription'], since: 33 },
  // Where new uploads go (ADR 0083, N11); the restored storages carry the same ids.
  { name: 'arkvory_storage_placement', key: ['repository'], since: 44 },
  // Tables of contents of archives (ADR 0083, N8): restored, the worker does not read them again.
  { name: 'arkvory_tree_indexes', key: ['upload_id'], since: 46 },
  { name: 'arkvory_tree_entries', key: ['upload_id', 'ordinal'], since: 46 },
  // Accepted licence documents (ADR 0078, R2); the activation secrets are files, never here.
  { name: 'arkvory_license_activations', key: ['activation_id'], since: 47 },
  { name: 'arkvory_license_clock', key: ['id'], since: 47 },
  { name: 'arkvory_license_revocations', key: ['id'], since: 47 },
];

/**
 * The tables a point of `schema` holds: a restore prepares that schema, loads these, and the
 * migrations after it create the later tables (and backfill them) on the restored data.
 */
export function tablesAt(schema: number): readonly BackupTable[] {
  return exportedTables.filter((table) => (table.since ?? MINIMUM_RESTORE_SCHEMA) <= schema);
}

export const excludedTables: readonly ExcludedTable[] = [
  {
    name: 'arkvory_module_state',
    reason:
      'installation-bound coordination state; modules explicitly reinitialize on a restored installation',
  },
  // ADR 0084: disposable cache state belongs to the source incarnation, never the restore.
  {
    name: 'arkvory_derived_cache_owners',
    reason: 'cache process incarnations of the source; never revived on restore',
  },
  {
    name: 'arkvory_derived_cache_entries',
    reason: 'non-authoritative cache pointers; regenerated on the target',
  },
  {
    name: 'arkvory_derived_cache_generations',
    reason: 'derived cache reservations and manifests; source cache files are not backed up',
  },
  {
    name: 'arkvory_derived_cache_read_refs',
    reason: 'runtime cache reader pins; restored targets have no source readers',
  },
  { name: 'arkvory_migrations', reason: 'schema history; restore migrates the target itself' },
  { name: 'arkvory_storage_identity', reason: 'bound to the new target storage directory' },
  {
    name: 'arkvory_storage_backends',
    reason: 'identities of the source storages; the restored storages are recorded at first start',
  },
  { name: 'arkvory_user_sessions', reason: 'ephemeral sign-in sessions are never restored' },
  { name: 'arkvory_transfer_links', reason: 'download links live at most a day; never restored' },
  { name: 'arkvory_gateway_leases', reason: 'runtime ownership of gateway slots' },
  { name: 'arkvory_fleet_pairings', reason: 'pairing codes live ten minutes; never restored' },
  {
    name: 'arkvory_fleet_controllers',
    reason: 'fleet trust of the source; a restored site is paired again',
  },
  {
    name: 'arkvory_fleet_sites',
    reason: 'site keys are sealed with a key outside the database; paired again after a restore',
  },
  {
    name: 'arkvory_download_ticket_key',
    reason: 'signs download queue tickets of the source; a restore makes its own',
  },
  { name: 'arkvory_download_policy', reason: 'gateway topology is configured on the target' },
  {
    name: 'arkvory_download_settings',
    reason:
      'download queue settings fit the hardware and link of the source; set again on the target',
  },
  { name: 'arkvory_backup_jobs', reason: 'backup state of the source instance' },
  { name: 'arkvory_backup_pins', reason: 'backup state of the source instance' },
  { name: 'arkvory_backup_barrier', reason: 'backup state of the source instance' },
  {
    name: 'arkvory_backup_plan',
    reason: 'backup schedule of the source; a restore starts with backups disabled',
  },
  { name: 'arkvory_backup_agent', reason: 'runtime ownership of the backup agent' },
  { name: 'arkvory_backup_requests', reason: 'backup state of the source instance' },
  { name: 'arkvory_backup_points', reason: 'catalog cache of the vault, rebuilt by the agent' },
  {
    name: 'arkvory_upload_bytes',
    // Derived (ADR 0073); reasons are lower-case manifest text.
    reason: 'derived from the uploads by a trigger; restore counts it again',
  },
  {
    name: 'arkvory_oci_uploads',
    reason: 'image uploads in progress; their staged bytes stay with the source',
  },
  // ADR 0080: events are a window, not history; a restored installation answers old cursors 409.
  {
    name: 'arkvory_events',
    reason: 'event window of the source; consumers resynchronize under the new epoch',
  },
  {
    name: 'arkvory_event_state',
    reason: 'epoch and positions of the source; migrating the target starts a new epoch',
  },
  // ADR 0083, N2: a move is a property of the source's storages; a restore writes every blob
  // to the storage its upload row names.
  {
    name: 'arkvory_blob_moves',
    reason: 'moves between storages of the source; a restore writes each blob to its storage',
  },
  {
    name: 'arkvory_license_requests',
    reason: 'offline licence requests wait on the source installation; a restore asks again',
  },
  {
    name: 'arkvory_module_plan',
    reason: 'module plan of the source writer; the writer of the target records its own',
  },
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

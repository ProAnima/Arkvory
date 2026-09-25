import type { PoolClient } from 'pg';
import { DepotError } from '@proanima/depot-domain';

/** Short metadata transactions only. Shared ordering with retirement prevents late pins/edits. */
export async function lockCatalogMutation(client: PoolClient, repository: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(18472,hashtext($1))', [repository]);
}
export async function requirePublished(
  client: PoolClient,
  repository: string,
  id: string,
): Promise<void> {
  const row = await client.query(
    "SELECT id FROM depot_uploads WHERE repository=$1 AND id=$2 AND status='available'",
    [repository, id],
  );
  if (row.rowCount !== 1) throw new DepotError('not_found', 'Artifact not found');
}

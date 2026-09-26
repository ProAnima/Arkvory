import type { PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';

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
    "SELECT id FROM arkvory_uploads WHERE repository=$1 AND id=$2 AND status='available'",
    [repository, id],
  );
  if (row.rowCount !== 1) throw new ArkvoryError('not_found', 'Artifact not found');
}

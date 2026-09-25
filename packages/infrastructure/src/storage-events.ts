import type { PoolClient } from 'pg';
import type { StorageEvent } from '@proanima/depot-application';

/** Call within a short transaction: serializes the bounded diagnostic history. */
export async function recordStorageEvent(
  c: PoolClient,
  repository: string,
  level: StorageEvent['level'],
  code: string,
  details: StorageEvent['details'],
) {
  await c.query('SELECT pg_advisory_xact_lock(18471,15)');
  await c.query(
    'INSERT INTO depot_storage_events(repository,level,code,details) VALUES($1,$2,$3,$4)',
    [repository, level, code, JSON.stringify(details)],
  );
  await c.query(
    `DELETE FROM depot_storage_events WHERE repository=$1 AND sequence <=
    (SELECT sequence FROM depot_storage_events WHERE repository=$1 ORDER BY sequence DESC OFFSET 1000 LIMIT 1)`,
    [repository],
  );
  await c.query(`DELETE FROM depot_storage_events WHERE sequence <=
    (SELECT sequence FROM depot_storage_events ORDER BY sequence DESC OFFSET 20000 LIMIT 1)`);
}

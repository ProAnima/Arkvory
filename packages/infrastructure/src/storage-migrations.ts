import type { PoolClient } from 'pg';
import { migrateStoragePolicy } from './storage-policy-schema.js';
import { migrateCleanup } from './cleanup-schema.js';

export async function migrateStorageSchemas(client: PoolClient) {
  await migrateStoragePolicy(client);
  await migrateCleanup(client);
}

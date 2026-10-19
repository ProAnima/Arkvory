import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Trusted host maintenance only. Confirmation is an operator attestation of OS quiescence,
 * not permission to infer process death from a missing PostgreSQL session or a PID timeout.
 */
export function recoveryOwner(args) {
  if (
    args.length !== 3 ||
    args[0] !== '--owner' ||
    args[2] !== '--confirm-owner-stopped' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])
  )
    throw new Error(
      'Usage: node scripts/recover-derived-cache.mjs --owner UUID --confirm-owner-stopped',
    );
  return args[1].toLowerCase();
}

export async function recover(args, env) {
  const owner = recoveryOwner(args);
  const connectionString = env.ARKVORY_DATABASE_URL;
  if (!connectionString) throw new Error('ARKVORY_DATABASE_URL is required');
  // Load the installed, built infrastructure only after validating explicit confirmation.
  const { Pool } = await import('pg');
  const { recoverDerivedCacheOwner } = await import('@proanima/arkvory-infrastructure');
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 35000,
  });
  try {
    await recoverDerivedCacheOwner(pool, owner, { confirmedStopped: true });
    process.stdout.write(
      `Derived-cache owner ${owner}: quiescence confirmed; reconciliation may reclaim retained files.\n`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await recover(process.argv.slice(2), process.env);
  } catch {
    // Database errors can include connection details; never print the URL or arbitrary stack.
    process.stderr.write(
      'Derived-cache recovery refused. Check arguments, database migration, owner identity and stopped-owner confirmation. No automatic retry.\n',
    );
    process.exitCode = 1;
  }
}

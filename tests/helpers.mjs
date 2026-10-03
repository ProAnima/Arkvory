import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export async function removeTestDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('arkvory-'))
    throw new Error('Refusing to remove a directory outside the test temp namespace');
  await rm(target, { recursive: true, force: true });
}

/**
 * Drops a temporary test database once its sessions are gone, then with FORCE. pg-pool's end()
 * resolves before its clients have closed their sockets; a forced drop at that moment
 * terminates them, and the idle client's error escapes as an unhandled pool error into
 * whichever test runs. Waits up to 5 s; a session that stays is then terminated as before.
 */
export async function dropTestDatabase(admin, name) {
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error('Invalid test database name');
  for (let attempt = 0; attempt < 50; attempt++) {
    const sessions = await admin.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',
      [name],
    );
    if (sessions.rows[0].n === 0) break;
    await delay(100);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

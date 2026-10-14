import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Schema version of the queue key table (ADR 0076, stage 2b). */
export const DOWNLOAD_TICKET_MIGRATION = 38;

/**
 * The key that signs queue tickets: one row, made by the first writer that starts. Every process
 * of an installation and every restart signs alike, so a ticket outlives the process that issued
 * it. It only orders the queue; a restore makes its own and is not backed up.
 */
export async function migrateDownloadTickets(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        DOWNLOAD_TICKET_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_download_ticket_key(
      id smallint PRIMARY KEY CHECK (id = 1),
      secret bytea NOT NULL CHECK (length(secret) = 32),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    DOWNLOAD_TICKET_MIGRATION,
  ]);
}

/**
 * The installation's ticket key. A writer creates it when missing; a read gateway only reads it
 * and goes without tickets until a writer made one, or until the schema has the table during a
 * rolling update.
 */
export async function loadDownloadTicketKey(
  pool: Pick<Pool, 'query'>,
  create: boolean,
): Promise<Buffer | undefined> {
  const present = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('arkvory_download_ticket_key') IS NOT NULL AS present",
  );
  if (present.rows[0]?.present !== true) return undefined;
  if (create)
    await pool.query(
      'INSERT INTO arkvory_download_ticket_key(id, secret) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',
      [randomBytes(32)],
    );
  const found = await pool.query<{ secret: Buffer }>(
    'SELECT secret FROM arkvory_download_ticket_key WHERE id = 1',
  );
  return found.rows[0]?.secret;
}

/** How long a ticket keeps a download's turn. */
const TICKET_MS = 24 * 60 * 60 * 1000;
const base64url = (bytes: Buffer) => bytes.toString('base64url');

/**
 * Queue tickets of ADR 0076: `1.<arrival>.<mac>`, the wall-clock time a download first came
 * and an HMAC over it and the session key. A client sends it back with its requests; after a
 * restart the download takes its old turn. It cannot be moved to another download or forged
 * earlier, and expires after a day. Anything wrong in it is ignored: the download queues anew.
 */
export class DownloadTickets {
  constructor(private readonly secret: Buffer) {}

  issue(key: string, arrivedAt: number): string {
    const arrival = Math.floor(arrivedAt).toString(36);
    return `1.${arrival}.${this.mac(key, arrival)}`;
  }

  /** The arrival time a valid ticket for `key` carries, or undefined. */
  read(key: string, ticket: string | undefined, now: number): number | undefined {
    const match =
      ticket === undefined ? null : /^1\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!match) return undefined;
    const [, arrival = '', mac = ''] = match;
    const expected = Buffer.from(this.mac(key, arrival));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    const arrivedAt = parseInt(arrival, 36);
    return arrivedAt <= now && now - arrivedAt <= TICKET_MS ? arrivedAt : undefined;
  }

  private mac(key: string, arrival: string) {
    // The key is hashed first: it holds principal ids, and only its digest enters the MAC.
    const session = createHash('sha256').update(key).digest();
    return base64url(createHmac('sha256', this.secret).update(session).update(arrival).digest());
  }
}

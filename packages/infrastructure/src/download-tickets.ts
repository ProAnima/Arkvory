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

/**
 * How long after its issue a ticket is accepted: the ten minutes a paused download keeps its turn
 * plus slack. Every answer re-issues the ticket, so a waiting client always holds a fresh one,
 * however long it waits; an old ticket cannot be replayed to restore an early arrival.
 */
const TICKET_MS = 15 * 60 * 1000;
/** Clocks of HA nodes differ a little: a time this far ahead is taken as now, not refused. */
const SKEW_MS = 2 * 60 * 1000;
const base64url = (bytes: Buffer) => bytes.toString('base64url');

/**
 * Queue tickets of ADR 0076: `2.<arrival>.<issued>.<mac>`, the wall-clock times a download first
 * came and the ticket was issued, base 36, and an HMAC over both and the session key. A client
 * sends it back with its requests; after a restart the download takes its old turn. It cannot be
 * moved to another download or forged earlier, and is accepted for 15 minutes after its issue.
 * Anything wrong in it is ignored: the download queues anew. Tickets of the first format
 * (`1.<arrival>.<mac>`) are no longer read: a ticket is a hint, losing one costs a place once.
 */
export class DownloadTickets {
  constructor(private readonly secret: Buffer) {}

  issue(key: string, arrivedAt: number, issuedAt: number): string {
    const arrival = Math.floor(Math.min(arrivedAt, issuedAt)).toString(36);
    const issued = Math.floor(issuedAt).toString(36);
    return `2.${arrival}.${issued}.${this.mac(key, arrival, issued)}`;
  }

  /** The arrival time a valid ticket for `key` carries, or undefined. */
  read(key: string, ticket: string | undefined, now: number): number | undefined {
    const match =
      ticket === undefined
        ? null
        : /^2\.([0-9a-z]{1,12})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
    if (!match) return undefined;
    const [, arrival = '', issued = '', mac = ''] = match;
    const expected = Buffer.from(this.mac(key, arrival, issued));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    const arrivedAt = parseInt(arrival, 36);
    const issuedAt = parseInt(issued, 36);
    if (arrivedAt > issuedAt || issuedAt > now + SKEW_MS || now - issuedAt > TICKET_MS)
      return undefined;
    return Math.min(arrivedAt, now);
  }

  private mac(key: string, arrival: string, issued: string) {
    // The key is hashed first: it holds principal ids, and only its digest enters the MAC. The
    // separator keeps the two times apart: base 36 digits never contain it.
    const session = createHash('sha256').update(key).digest();
    return base64url(
      createHmac('sha256', this.secret).update(session).update(`${arrival}.${issued}`).digest(),
    );
  }
}

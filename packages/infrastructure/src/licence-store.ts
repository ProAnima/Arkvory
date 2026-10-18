import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import type {
  LicenceRequestRecord,
  LicenceStore,
  LicenceTokenRecord,
  StoredActivation,
} from '@proanima/arkvory-application';

/** Advisory lock 18471/30: one licence exchange of the installation at a time. */
export const LICENCE_EXCHANGE_LOCK = 30;

/**
 * Version 45 (ADR 0078, R2), expand-only. Activations keep the exact documents the core
 * accepted; the other columns schedule refreshes and are never trusted for a licence decision
 * (readers verify the token text again). The activation secret is not here: it is a file of the
 * service account, outside the database and its backups. Requests of offline activation are
 * pending state of this installation and stay out of backups.
 */
export async function migrateLicences(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=45')).rowCount)
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_license_activations (
      activation_id text PRIMARY KEY,
      licence_id text NOT NULL,
      installation text NOT NULL,
      activation text NOT NULL CHECK (activation IN ('online','offline')),
      token text NOT NULL,
      seq bigint NOT NULL CHECK (seq > 0),
      issued_at timestamptz NOT NULL,
      refresh_after timestamptz NOT NULL,
      not_after timestamptz NOT NULL,
      revocation text,
      pending_nonce text,
      pending_seq bigint,
      pending_since timestamptz,
      last_refresh_at timestamptz,
      failure text,
      failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
      next_attempt_at timestamptz,
      mismatch_since timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arkvory_license_clock (
      id smallint PRIMARY KEY CHECK (id = 1),
      max_seen_at timestamptz NOT NULL,
      installation text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arkvory_license_revocations (
      id smallint PRIMARY KEY CHECK (id = 1),
      number bigint NOT NULL CHECK (number > 0),
      document text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS arkvory_license_requests (
      nonce text PRIMARY KEY,
      installation text NOT NULL,
      key_sha256 char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO arkvory_migrations(version) VALUES(45);
  `);
}

interface ActivationRow {
  activation_id: string;
  licence_id: string;
  installation: string;
  activation: 'online' | 'offline';
  token: string;
  seq: string;
  revocation: string | null;
  pending_nonce: string | null;
  pending_seq: string | null;
  pending_since: Date | null;
  last_refresh_at: Date | null;
  failure: string | null;
  failures: number;
  next_attempt_at: Date | null;
  mismatch_since: Date | null;
}

const COLUMNS = `activation_id, licence_id, installation, activation, token, seq::text AS seq, revocation,
  pending_nonce, pending_seq::text AS pending_seq, pending_since, last_refresh_at, failure, failures,
  next_attempt_at, mismatch_since`;
const time = (value: Date | null) => (value === null ? null : value.getTime());
const date = (value: number | null) => (value === null ? null : new Date(value));

function activationOf(row: ActivationRow): StoredActivation {
  return {
    activationId: row.activation_id,
    licenceId: row.licence_id,
    installation: row.installation,
    activation: row.activation,
    token: row.token,
    seq: Number(row.seq),
    revocation: row.revocation,
    pendingNonce: row.pending_nonce,
    pendingSeq: row.pending_seq === null ? null : Number(row.pending_seq),
    pendingSince: time(row.pending_since),
    lastRefreshAt: time(row.last_refresh_at),
    failure: row.failure,
    failures: row.failures,
    nextAttemptAt: time(row.next_attempt_at),
    mismatchSince: time(row.mismatch_since),
  };
}

export class PostgresLicenceStore implements LicenceStore {
  constructor(private readonly pool: Pool) {}

  async databaseNow(): Promise<number> {
    const result = await this.pool.query<{ now: Date }>('SELECT now() AS now');
    return result.rows[0]?.now.getTime() ?? Number.NaN;
  }

  async clock() {
    const result = await this.pool.query<{
      max_seen_at: Date | null;
      installation: string | null;
      max_issued: Date | null;
    }>(`SELECT (SELECT max_seen_at FROM arkvory_license_clock WHERE id=1) AS max_seen_at,
      (SELECT installation FROM arkvory_license_clock WHERE id=1) AS installation,
      (SELECT max(issued_at) FROM arkvory_license_activations) AS max_issued`);
    const row = result.rows[0];
    return {
      maxSeen: time(row?.max_seen_at ?? null),
      installation: row?.installation ?? null,
      maxIssued: time(row?.max_issued ?? null),
    };
  }

  /**
   * The writer's tick: the highest database time only grows; an installation id other than the
   * token's marks the activation from this moment (its grace runs from discovery, ADR 0078, 6.2).
   */
  async observe(installation: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_license_clock(id, max_seen_at, installation) VALUES (1, now(), $1)
       ON CONFLICT (id) DO UPDATE SET max_seen_at=GREATEST(arkvory_license_clock.max_seen_at, now()),
         installation=COALESCE($1, arkvory_license_clock.installation), updated_at=now()`,
      [installation],
    );
    if (installation === null) return;
    await this.pool.query(
      `UPDATE arkvory_license_activations SET
         mismatch_since = CASE WHEN installation <> $1 THEN COALESCE(mismatch_since, now()) END
       WHERE (installation <> $1 AND mismatch_since IS NULL) OR (installation = $1 AND mismatch_since IS NOT NULL)`,
      [installation],
    );
  }

  async activations(): Promise<readonly StoredActivation[]> {
    const result = await this.pool.query<ActivationRow>(
      `SELECT ${COLUMNS} FROM arkvory_license_activations ORDER BY created_at, activation_id`,
    );
    return result.rows.map(activationOf);
  }

  async activation(activationId: string): Promise<StoredActivation | null> {
    const result = await this.pool.query<ActivationRow>(
      `SELECT ${COLUMNS} FROM arkvory_license_activations WHERE activation_id=$1`,
      [activationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : activationOf(row);
  }

  /**
   * Inserts or replaces the token of an activation only with a higher `seq` than every kept
   * document: a replayed token cannot bring back the features of an earlier plan or undo a
   * revocation (a statement carries the seq after the last token).
   */
  async saveToken(record: LicenceTokenRecord): Promise<'saved' | 'stale'> {
    const result = await this.pool.query(
      `INSERT INTO arkvory_license_activations(activation_id, licence_id, installation, activation,
         token, seq, issued_at, refresh_after, not_after, next_attempt_at, last_refresh_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (activation_id) DO UPDATE SET licence_id=EXCLUDED.licence_id,
         installation=EXCLUDED.installation, activation=EXCLUDED.activation, token=EXCLUDED.token,
         seq=EXCLUDED.seq, issued_at=EXCLUDED.issued_at, refresh_after=EXCLUDED.refresh_after,
         not_after=EXCLUDED.not_after, next_attempt_at=EXCLUDED.next_attempt_at, revocation=NULL,
         pending_nonce=NULL, pending_seq=NULL, pending_since=NULL, failure=NULL, failures=0,
         last_refresh_at=now(), updated_at=now()
       WHERE arkvory_license_activations.seq < EXCLUDED.seq`,
      [
        record.activationId,
        record.licenceId,
        record.installation,
        record.activation,
        record.token,
        record.seq,
        new Date(record.issuedAt),
        new Date(record.refreshAfter),
        new Date(record.notAfter),
        date(record.nextAttemptAt),
      ],
    );
    return result.rowCount === 1 ? 'saved' : 'stale';
  }

  async saveRevocation(activationId: string, text: string, seq: number, issuedAt: number) {
    const result = await this.pool.query(
      `UPDATE arkvory_license_activations SET revocation=$2, seq=$3,
         issued_at=GREATEST(issued_at, $4), next_attempt_at=NULL, failure=NULL, failures=0,
         pending_nonce=NULL, pending_seq=NULL, pending_since=NULL, last_refresh_at=now(), updated_at=now()
       WHERE activation_id=$1 AND seq < $3`,
      [activationId, text, seq, new Date(issuedAt)],
    );
    return result.rowCount === 1 ? ('saved' as const) : ('stale' as const);
  }

  async startAttempt(activationId: string, nonce: string, seq: number): Promise<void> {
    await this.pool.query(
      `UPDATE arkvory_license_activations SET pending_nonce=$2, pending_seq=$3,
         pending_since=CASE WHEN pending_nonce IS DISTINCT FROM $2 THEN now() ELSE pending_since END,
         updated_at=now()
       WHERE activation_id=$1`,
      [activationId, nonce, seq],
    );
  }

  async recordFailure(activationId: string, failure: string, nextAttemptAt: number | null) {
    await this.pool.query(
      `UPDATE arkvory_license_activations SET failure=$2, failures=failures+1, next_attempt_at=$3,
         updated_at=now() WHERE activation_id=$1`,
      [activationId, failure, date(nextAttemptAt)],
    );
  }

  async remove(activationId: string): Promise<void> {
    await this.pool.query('DELETE FROM arkvory_license_activations WHERE activation_id=$1', [
      activationId,
    ]);
  }

  async revocationList() {
    const result = await this.pool.query<{ number: string; document: string }>(
      'SELECT number::text AS number, document FROM arkvory_license_revocations WHERE id=1',
    );
    const row = result.rows[0];
    return row === undefined ? null : { number: Number(row.number), text: row.document };
  }

  async saveRevocationList(number: number, text: string) {
    const kept = await this.revocationList();
    if (kept !== null && number < kept.number) return 'stale' as const;
    if (kept !== null && number === kept.number)
      return kept.text === text ? ('unchanged' as const) : ('conflict' as const);
    const result = await this.pool.query(
      `INSERT INTO arkvory_license_revocations(id, number, document) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, document=EXCLUDED.document,
         accepted_at=now() WHERE arkvory_license_revocations.number < EXCLUDED.number`,
      [number, text],
    );
    return result.rowCount === 1 ? ('saved' as const) : ('stale' as const);
  }

  async saveRequest(request: LicenceRequestRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_license_requests(nonce, installation, key_sha256, created_at)
       VALUES ($1,$2,$3,$4)`,
      [request.nonce, request.installation, request.keySha256, new Date(request.createdAt)],
    );
  }

  async request(nonce: string): Promise<LicenceRequestRecord | null> {
    const result = await this.pool.query<{
      nonce: string;
      installation: string;
      key_sha256: string;
      created_at: Date;
    }>(
      'SELECT nonce, installation, key_sha256, created_at FROM arkvory_license_requests WHERE nonce=$1',
      [nonce],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          nonce: row.nonce,
          installation: row.installation,
          keySha256: row.key_sha256,
          createdAt: row.created_at.getTime(),
        };
  }

  async pendingRequests(): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM arkvory_license_requests',
    );
    return result.rows[0]?.n ?? 0;
  }

  async removeRequest(nonce: string): Promise<void> {
    await this.pool.query('DELETE FROM arkvory_license_requests WHERE nonce=$1', [nonce]);
  }

  /**
   * Holds the session lock 18471/30 on one connection for the whole exchange, HTTP included;
   * the lock ends with the connection if the process dies, so no exchange stays blocked.
   */
  async exclusive<T>(work: () => Promise<T>, waitMs: number): Promise<T | 'busy'> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const result = await client.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_lock(18471, ${String(LICENCE_EXCHANGE_LOCK)}) AS locked`,
        );
        locked = result.rows[0]?.locked === true;
        if (locked) break;
        if (Date.now() >= deadline) return 'busy';
        await delay(Math.min(500, Math.max(deadline - Date.now(), 1)));
      }
      return await work();
    } finally {
      // A connection whose unlock failed still holds the lock: destroy it, never pool it.
      const unlocked =
        !locked ||
        (await client
          .query(`SELECT pg_advisory_unlock(18471, ${String(LICENCE_EXCHANGE_LOCK)})`)
          .then(
            () => true,
            () => false,
          ));
      client.release(!unlocked);
    }
  }
}

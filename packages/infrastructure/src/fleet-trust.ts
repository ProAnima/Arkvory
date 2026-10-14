import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError, type Principal } from '@proanima/arkvory-domain';

/** Pairing codes live ten minutes and are shown once. */
const CODE_MS = 10 * 60 * 1000;
/** Crockford base32 without I, L, O, U: read aloud or typed without confusion. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FLEET_KEY_PREFIX = 'afk_';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** `XXXX-XXXX-XXXX`: 60 random bits; with a ten-minute life and throttled enrollment, enough. */
function pairingCode(): string {
  const bytes = randomBytes(12);
  const letters = Array.from(bytes, (byte) => ALPHABET[byte % 32] ?? '0').join('');
  return `${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8, 12)}`;
}
/** Codes are compared in one form: upper case, without separators. */
const normal = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');

export interface FleetController {
  readonly id: string;
  readonly name: string;
  readonly pairedBy: string;
  readonly pairedAt: string;
  readonly usedAt: string | null;
}

/**
 * The trust of a site in the controllers that manage it (ADR 0077). A site's administrator makes
 * a pairing code; the controller trades it once for a fleet key. Codes and keys are kept only as
 * SHA-256; a revoked controller is refused at once.
 */
export class PostgresFleetTrust {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async createPairing(createdBy: string, now = new Date()) {
    const code = pairingCode();
    const expiresAt = new Date(now.getTime() + CODE_MS);
    await this.pool.query('DELETE FROM arkvory_fleet_pairings WHERE expires_at < now()');
    await this.pool.query(
      'INSERT INTO arkvory_fleet_pairings(code_sha256, created_by, expires_at) VALUES ($1, $2, $3)',
      [digest(normal(code)), createdBy, expiresAt],
    );
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Trades a live code for a new controller and its key, once. */
  async enroll(code: unknown, name: unknown) {
    if (typeof code !== 'string' || normal(code).length !== 12)
      throw new ArkvoryError('invalid_input', 'Invalid pairing code');
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 63 || Array.from(trimmed).some((c) => c.charCodeAt(0) < 32))
      throw new ArkvoryError('invalid_input', 'Controller name must have 1 to 63 characters');
    const used = await this.pool.query<{ created_by: string }>(
      'DELETE FROM arkvory_fleet_pairings WHERE code_sha256 = $1 AND expires_at >= now() RETURNING created_by',
      [digest(normal(code))],
    );
    const pairing = used.rows[0];
    if (!pairing)
      throw new ArkvoryError('unauthorized', 'Pairing code is unknown, used or expired', {
        reason: 'credential_invalid',
      });
    const key = FLEET_KEY_PREFIX + randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.pool.query(
      'INSERT INTO arkvory_fleet_controllers(id, name, key_sha256, paired_by) VALUES ($1, $2, $3, $4)',
      [id, trimmed, digest(key), pairing.created_by],
    );
    return { id, key };
  }

  /** The principal of a live fleet key, or null. Its routes are limited by the caller. */
  async resolve(key: string): Promise<Principal | null> {
    if (!key.startsWith(FLEET_KEY_PREFIX)) return null;
    const hash = digest(key);
    const found = await this.pool.query<{ id: string; key_sha256: Buffer }>(
      `UPDATE arkvory_fleet_controllers SET used_at = now()
       WHERE key_sha256 = $1 AND revoked_at IS NULL RETURNING id, key_sha256`,
      [hash],
    );
    const row = found.rows[0];
    if (!row || !timingSafeEqual(row.key_sha256, hash)) return null;
    const repositories = await this.repositories();
    return {
      credential: 'fleet-key',
      id: `fleet:${row.id}`,
      administrator: true,
      repositories: [],
      permissions: [],
      // Read, never write: a controller browses catalog metadata (ADR 0077, stage F2).
      grants: repositories.map((repository) => ({ repository, permissions: ['read'] })),
    };
  }

  /**
   * Repositories that hold anything: the distinct names of the catalog journal, read by skipping
   * along its index (one lookup per repository, not a scan of the journal). At most 1000.
   */
  private async repositories(): Promise<readonly string[]> {
    const rows = await this.pool.query<{ repository: string }>(
      `WITH RECURSIVE names(repository) AS (
         SELECT min(repository) FROM arkvory_audit
         UNION ALL
         SELECT (SELECT min(repository) FROM arkvory_audit WHERE repository > names.repository)
         FROM names WHERE names.repository IS NOT NULL
       )
       SELECT repository FROM names WHERE repository IS NOT NULL LIMIT 1000`,
    );
    return rows.rows.map((row) => row.repository);
  }

  async controllers(): Promise<readonly FleetController[]> {
    const rows = await this.pool.query<{
      id: string;
      name: string;
      paired_by: string;
      paired_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, name, paired_by, paired_at, used_at FROM arkvory_fleet_controllers
       WHERE revoked_at IS NULL ORDER BY paired_at LIMIT 100`,
    );
    return rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      pairedBy: row.paired_by,
      pairedAt: row.paired_at.toISOString(),
      usedAt: row.used_at?.toISOString() ?? null,
    }));
  }

  async revoke(id: string) {
    const result = await this.pool.query(
      'UPDATE arkvory_fleet_controllers SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id],
    );
    if (!result.rowCount) throw new ArkvoryError('not_found', 'Controller not found');
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type {
  CreatedDownloadLink,
  CredentialRejection,
  DownloadLinkBinding,
  DownloadLinkStore,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

const format = /^dtl_[A-Za-z0-9_-]{43}$/;
/** Live links one issuer may hold; links expire within a day, so the cap renews itself. */
const maxActiveLinks = 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Download links in PostgreSQL (ADR 0062). Expiry is decided by the database clock, like the
 * other credentials. Expired rows are removed when an issuer creates a link, bounded per call.
 */
export class PostgresTransferLinks implements DownloadLinkStore {
  constructor(private readonly pool: Pool) {}

  async create(
    link: DownloadLinkBinding & { readonly ttlSeconds: number },
  ): Promise<CreatedDownloadLink> {
    const token = `dtl_${randomBytes(32).toString('base64url')}`;
    return inTransaction(this.pool, async (client) => {
      // One issuer at a time: the count and the insert below must see the same rows.
      await client.query('SELECT pg_advisory_xact_lock(18474, hashtext($1))', [link.issuer]);
      await client.query(
        `DELETE FROM arkvory_transfer_links WHERE id IN
           (SELECT id FROM arkvory_transfer_links WHERE expires_at < now() LIMIT 1000)`,
      );
      const active = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM arkvory_transfer_links WHERE issuer=$1 AND expires_at>now()',
        [link.issuer],
      );
      if (Number(active.rows[0]?.count ?? 0) >= maxActiveLinks)
        throw new ArkvoryError('capacity_exceeded', 'Too many live download links', {
          reason: 'token_limit',
        });
      const result = await client.query<{ expires_at: Date }>(
        `INSERT INTO arkvory_transfer_links(id,token_hash,repository,artifact_id,issuer,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+make_interval(secs => $6)) RETURNING expires_at`,
        [
          randomUUID(),
          digest(token),
          link.repository,
          link.artifactId,
          link.issuer,
          link.ttlSeconds,
        ],
      );
      const expires = result.rows[0]?.expires_at;
      if (!expires) throw new Error('Download link was not stored');
      return { token, expiresAt: expires.toISOString() };
    });
  }

  async resolve(token: string): Promise<DownloadLinkBinding | null> {
    if (!format.test(token)) return null;
    const result = await this.pool.query<{
      repository: string;
      artifact_id: string;
      issuer: string;
    }>(
      `SELECT repository, artifact_id::text, issuer FROM arkvory_transfer_links
       WHERE token_hash=$1 AND expires_at>now()`,
      [digest(token)],
    );
    const row = result.rows[0];
    return row
      ? { repository: row.repository, artifactId: row.artifact_id, issuer: row.issuer }
      : null;
  }

  async rejection(token: string): Promise<CredentialRejection> {
    if (!format.test(token)) return 'credential_invalid';
    const result = await this.pool.query(
      'SELECT 1 FROM arkvory_transfer_links WHERE token_hash=$1 AND expires_at<=now()',
      [digest(token)],
    );
    return result.rowCount ? 'token_expired' : 'credential_invalid';
  }
}

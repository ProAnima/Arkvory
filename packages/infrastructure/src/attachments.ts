import type { Pool } from 'pg';
import { ArkvoryError, parseAttachments } from '@proanima/arkvory-domain';
import type { BuildAttachment, MutationAccess } from '@proanima/arkvory-domain';
import type { AttachmentRevision, AttachmentStore } from '@proanima/arkvory-application';
import { lockCatalogMutation, requirePublished } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { accessCorrelation } from './request-correlation.js';

interface RevisionRow {
  revision: number;
  items: unknown;
  actor: string;
  created_at: Date;
}
const read = (row: RevisionRow, id: string): AttachmentRevision => ({
  revision: row.revision,
  items: parseAttachments(row.items, id),
  actor: row.actor,
  createdAt: row.created_at.toISOString(),
});
export class PostgresAttachments implements AttachmentStore {
  constructor(private readonly pool: Pool) {}
  async get(repository: string, id: string): Promise<AttachmentRevision> {
    const result = await this.pool.query<RevisionRow>(
      `SELECT a.* FROM arkvory_attachment_revisions a JOIN arkvory_uploads u ON u.id=a.artifact_id
       WHERE u.repository=$1 AND u.id=$2 AND u.status='available' ORDER BY a.revision DESC LIMIT 1`,
      [repository, id],
    );
    const row = result.rows[0];
    return row ? read(row, id) : { revision: 0, items: [], actor: null, createdAt: null };
  }
  async history(repository: string, id: string, before?: number) {
    const result = await this.pool.query<RevisionRow>(
      `SELECT a.* FROM arkvory_attachment_revisions a JOIN arkvory_uploads u ON u.id=a.artifact_id
       WHERE u.repository=$1 AND u.id=$2 AND u.status='available' AND ($3::integer IS NULL OR a.revision<$3)
       ORDER BY a.revision DESC LIMIT 21`,
      [repository, id, before ?? null],
    );
    const items = result.rows.slice(0, 20).map((row) => read(row, id));
    return { items, next: result.rows.length > 20 ? (items.at(-1)?.revision ?? null) : null };
  }
  async replace(
    repository: string,
    id: string,
    expected: number,
    items: readonly BuildAttachment[],
    access: MutationAccess,
  ) {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await lockServiceAccess(client, access);
      await lockCatalogMutation(client, repository);
      await requirePublished(client, repository, id);
      // Keep the parent revision lock after the repository gate. No byte I/O in this transaction.
      const parent = await client.query(
        "SELECT id FROM arkvory_uploads WHERE id=$1 AND repository=$2 AND status='available' FOR NO KEY UPDATE",
        [id, repository],
      );
      if (parent.rowCount !== 1) throw new ArkvoryError('not_found', 'Build not found');
      const current = await client.query<{ revision: number }>(
        'SELECT revision FROM arkvory_attachment_revisions WHERE artifact_id=$1 ORDER BY revision DESC LIMIT 1',
        [id],
      );
      if ((current.rows[0]?.revision ?? 0) !== expected)
        throw new ArkvoryError('conflict', 'Attachments changed; reload before saving');
      const ids = [...new Set(items.map((item) => item.artifactId))];
      const targets = await client.query(
        "SELECT id FROM arkvory_uploads WHERE id=ANY($1::uuid[]) AND repository=$2 AND status='available'",
        [ids, repository],
      );
      if (targets.rowCount !== ids.length)
        throw new ArkvoryError('not_found', 'Attachment target not found');
      const inserted = await client.query<RevisionRow>(
        'INSERT INTO arkvory_attachment_revisions(artifact_id,revision,items,actor) VALUES($1,$2,$3,$4) RETURNING *',
        [id, expected + 1, JSON.stringify(items), access.principal.id],
      );
      await client.query(
        'INSERT INTO arkvory_attachment_targets(parent_id,revision,target_id) SELECT $1,$2,unnest($3::uuid[])',
        [id, expected + 1, ids],
      );
      await appendCatalogAudit(
        client,
        [{ repository, artifactId: id, actor: access.principal.id, action: 'attachments.replace' }],
        accessCorrelation(access),
      );
      const row = inserted.rows[0];
      if (!row) throw new ArkvoryError('unavailable', 'Attachment revision missing');
      await client.query('COMMIT');
      return read(row, id);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
}

import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type {
  FleetSiteRecord,
  FleetSiteStore,
  FleetObservation,
} from '@proanima/arkvory-application';

interface Row {
  id: string;
  name: string;
  url: string;
  pin: string | null;
  certificate: string | null;
  key_box: Buffer;
  added_by: string;
  added_at: Date;
  seen_at: Date | null;
  state: string;
  error: string | null;
  topology: unknown;
}

const record = (row: Row): FleetSiteRecord => ({
  id: row.id,
  name: row.name,
  url: row.url,
  pin: row.pin,
  certificate: row.certificate,
  sealedKey: row.key_box,
  addedBy: row.added_by,
  addedAt: row.added_at.toISOString(),
  seenAt: row.seen_at?.toISOString() ?? null,
  state: row.state,
  error: row.error,
  topology: row.topology ?? null,
});

/** The sites of a controller (ADR 0077); their keys only sealed. */
export class PostgresFleetRegistry implements FleetSiteStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async list(): Promise<readonly FleetSiteRecord[]> {
    const rows = await this.pool.query<Row>(
      'SELECT * FROM arkvory_fleet_sites ORDER BY name, url LIMIT 256',
    );
    return rows.rows.map(record);
  }

  async get(id: string): Promise<FleetSiteRecord | null> {
    const rows = await this.pool.query<Row>('SELECT * FROM arkvory_fleet_sites WHERE id = $1', [
      id,
    ]);
    const row = rows.rows[0];
    return row ? record(row) : null;
  }

  async add(site: Omit<FleetSiteRecord, 'addedAt' | 'seenAt' | 'state' | 'error' | 'topology'>) {
    const count = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM arkvory_fleet_sites',
    );
    if (Number(count.rows[0]?.count ?? 0) >= 256)
      throw new ArkvoryError('capacity_exceeded', 'A controller manages at most 256 sites');
    try {
      await this.pool.query(
        `INSERT INTO arkvory_fleet_sites(id, name, url, pin, certificate, key_box, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [site.id, site.name, site.url, site.pin, site.certificate, site.sealedKey, site.addedBy],
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505')
        throw new ArkvoryError('conflict', 'This site is already managed here', {
          reason: 'already_exists',
        });
      throw error;
    }
  }

  async observe(id: string, observation: FleetObservation) {
    await this.pool.query(
      `UPDATE arkvory_fleet_sites SET state = $2::text, error = $3::text,
         seen_at = CASE WHEN $2::text = 'ok' THEN now() ELSE seen_at END,
         topology = CASE WHEN $2::text = 'ok' THEN $4::jsonb ELSE topology END,
         name = COALESCE($5::text, name)
       WHERE id = $1`,
      [
        id,
        observation.state,
        observation.error,
        observation.topology === undefined ? null : JSON.stringify(observation.topology),
        observation.name ?? null,
      ],
    );
  }

  async remove(id: string) {
    const result = await this.pool.query('DELETE FROM arkvory_fleet_sites WHERE id = $1', [id]);
    if (!result.rowCount) throw new ArkvoryError('not_found', 'Site not found');
  }
}

import type { Pool } from 'pg';
import type { ArtifactHolder, MirrorAdoptionStore } from '@proanima/arkvory-application';

/** Artifact holders and versions taken over by an import, in the catalog (ADR 0058). */
export class PostgresMirrorAdoptions implements MirrorAdoptionStore {
  constructor(private readonly pool: Pool) {}

  async holder(id: string): Promise<ArtifactHolder | null> {
    const found = await this.pool.query<ArtifactHolder>(
      'SELECT repository, status, owner FROM arkvory_uploads WHERE id=$1',
      [id],
    );
    return found.rows[0] ?? null;
  }

  async record(repository: string, id: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_mirror_adoptions(repository, artifact_id) VALUES($1, $2)
       ON CONFLICT DO NOTHING`,
      [repository, id],
    );
  }

  async settled(repository: string, id: string, synchronizer: string): Promise<boolean> {
    const found = await this.pool.query<{ settled: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM arkvory_mirror_adoptions WHERE repository=$1 AND artifact_id=$2)
         OR EXISTS(SELECT 1 FROM arkvory_uploads WHERE repository=$1 AND id=$2 AND owner<>$3)
         AS settled`,
      [repository, id, synchronizer],
    );
    return found.rows[0]?.settled === true;
  }
}

import type { PoolClient } from 'pg';
import { catalogEventActions, catalogEventDraft } from '@proanima/arkvory-domain';
import type { ArtifactFacts, EventDraft, JournalRow } from '@proanima/arkvory-domain';

interface FactRow {
  id: string;
  name: unknown;
  size: string;
  sha256: unknown;
  labels: unknown;
  stages: string[] | null;
  package_group: string | null;
  package_name: string | null;
  package_version: string | null;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter((item): item is string => typeof item === 'string');
}

/**
 * Descriptor facts of the named artifacts as the caller's transaction sees them: labels after
 * an annotation change, stages after a stage change. Rows of any status, so a deletion still
 * describes what went.
 */
async function artifactFacts(
  client: PoolClient,
  ids: readonly string[],
): Promise<ReadonlyMap<string, ArtifactFacts>> {
  const result = await client.query<FactRow>(
    `SELECT u.id::text, u.descriptor->'name' AS name, u.size::text, u.descriptor->'sha256' AS sha256,
       COALESCE(a.labels, u.descriptor->'labels', '[]'::jsonb) AS labels,
       (SELECT array_agg(s.stage ORDER BY s.stage) FROM arkvory_artifact_stages s
         WHERE s.repository=u.repository AND s.artifact_id=u.id) AS stages,
       p.package_group, p.name AS package_name, p.version AS package_version
     FROM arkvory_uploads u
     LEFT JOIN arkvory_annotations a ON a.artifact_id=u.id
     LEFT JOIN LATERAL (SELECT package_group, name, version FROM arkvory_packages k
       WHERE k.repository=u.repository AND k.artifact_id=u.id LIMIT 1) p ON true
     WHERE u.id=ANY($1::uuid[])`,
    [ids],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        name: typeof row.name === 'string' ? row.name : '',
        size: row.size,
        sha256: typeof row.sha256 === 'string' ? row.sha256 : '',
        labels: strings(row.labels),
        stages: row.stages ?? [],
        package:
          row.package_group !== null && row.package_name !== null && row.package_version !== null
            ? { group: row.package_group, name: row.package_name, version: row.package_version }
            : null,
      },
    ]),
  );
}

/**
 * Writes the events of catalog journal rows in the caller's transaction (ADR 0080): an event
 * commits exactly when its change commits. Positions stay NULL here; the sequencer assigns them
 * after commit, so a reader's cursor never passes an event that commits later. Rows keep the
 * journal order, and actions without an event type write nothing.
 */
export async function appendCatalogEvents(
  client: PoolClient,
  rows: readonly JournalRow[],
): Promise<void> {
  const relevant = rows.filter((row) => catalogEventActions[row.action] !== undefined);
  if (relevant.length === 0) return;
  const facts = await artifactFacts(client, [...new Set(relevant.map((row) => row.artifactId))]);
  const drafts = relevant
    .map((row) => catalogEventDraft(row, facts.get(row.artifactId) ?? null))
    .filter((draft): draft is EventDraft => draft !== null);
  await client.query(
    `INSERT INTO arkvory_events(type,schema_version,scope,repository,partition_key,subject,labels,data)
     SELECT t.type, t.schema_version, t.scope, t.repository, t.partition_key, t.subject,
       ARRAY(SELECT jsonb_array_elements_text(t.labels)), t.data
     FROM unnest($1::text[], $2::integer[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::jsonb[], $8::jsonb[])
       WITH ORDINALITY AS t(type, schema_version, scope, repository, partition_key, subject,
         labels, data, ordinal)
     ORDER BY t.ordinal`,
    [
      drafts.map((draft) => draft.type),
      drafts.map((draft) => draft.schemaVersion),
      drafts.map((draft) => draft.scope),
      drafts.map((draft) => draft.repository),
      drafts.map((draft) => draft.partitionKey),
      drafts.map((draft) => draft.subject),
      drafts.map((draft) => JSON.stringify(draft.labels)),
      drafts.map((draft) => JSON.stringify(draft.data)),
    ],
  );
}

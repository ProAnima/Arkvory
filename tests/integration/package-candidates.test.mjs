import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresPackageCandidates, migrate } from '@proanima/arkvory-infrastructure';
import { emptySchema } from './schema-fingerprint.mjs';

/*
 * Keyset pages of package versions (ADR 0075) visit every version exactly once, in the order of
 * one complete query, also where many rows share a sort position.
 */

async function seed(pool) {
  await migrate(pool);
  const rows = [];
  for (let index = 0; index < 450; index++) {
    // 30 versions repeat with build metadata: equal SemVer keys, distinct version strings.
    const version =
      index % 15 === 0
        ? `1.${String(index % 7)}.0+b${String(index)}`
        : `1.${String(index % 7)}.${String(index)}`;
    const id = randomUUID();
    rows.push({ id, version });
    await pool.query(
      `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
       VALUES($1::uuid,'r','w',$1::text,$2,1,'available',now())`,
      [id, JSON.stringify({ name: 'a.upack', size: '1', sha256: 'a'.repeat(64) })],
    );
    await pool.query(
      `INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest)
       VALUES('r','','app',$1,$2,'{}')`,
      [version, id],
    );
    // Promotions in groups of ten share one time, so the artifact decides inside a group.
    if (index % 2 === 0)
      await pool.query(
        `INSERT INTO arkvory_artifact_stages(repository,artifact_id,stage,promoted_at,actor)
         VALUES('r',$1,'release', timestamptz '2026-01-01' + ($2 || ' seconds')::interval, 'a')`,
        [id, String(Math.floor(index / 20))],
      );
  }
  return rows;
}

async function walk(store, query) {
  const seen = [];
  let cursor = null;
  do {
    const page = await store.candidates('r', query, cursor, 200);
    seen.push(...page.items.map((item) => item.artifactId));
    cursor = page.cursor;
  } while (cursor !== null);
  return seen;
}

test('keyset pages return every version once, in the order of one complete query', async (t) => {
  const pool = await emptySchema(t);
  await seed(pool);
  const store = new PostgresPackageCandidates(pool);
  const bySemver = (
    await pool.query(
      `SELECT artifact_id::text FROM arkvory_packages WHERE repository='r'
       ORDER BY arkvory_semver_key(version) COLLATE "C" DESC, version COLLATE "C", artifact_id`,
    )
  ).rows.map((row) => row.artifact_id);
  assert.deepEqual(await walk(store, { group: '', name: 'app' }), bySemver);
  const byPromotion = (
    await pool.query(
      `SELECT artifact_id::text FROM arkvory_artifact_stages WHERE repository='r' AND stage='release'
       ORDER BY promoted_at DESC, artifact_id`,
    )
  ).rows.map((row) => row.artifact_id);
  assert.equal(byPromotion.length, 225);
  assert.deepEqual(
    await walk(store, { group: '', name: 'app', stage: 'release', order: 'promoted' }),
    byPromotion,
  );
  // A stage filter in SemVer order pages by version, not by promotion time.
  const stagedBySemver = bySemver.filter((id) => byPromotion.includes(id));
  assert.deepEqual(await walk(store, { group: '', name: 'app', stage: 'release' }), stagedBySemver);
});

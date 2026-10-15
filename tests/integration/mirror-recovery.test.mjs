import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PostgresMirrorState } from '@proanima/arkvory-infrastructure';
import { call, content, never, pair, publish, upack } from './mirror-fixture.mjs';

/*
 * Replication between installations where it can go wrong (ADR 0058, 2026-10-12): a promotion
 * into the mirrored repository, a detached mirror, a package version both sides claim, a copy
 * longer than an upload's lifetime and an artifact ID another repository holds. The last two
 * conflicts are put aside while the feed goes on (2026-10-15).
 */

/** An upload into any repository of the installation, as CI would make it. */
async function publishTo(f, repository, bytes, name) {
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repository}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: {
      name,
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: [],
      metadata: {},
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repository}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  return id;
}

const failsWith = (code) => (error) => error?.code === code;

test('a version promoted into the mirrored repository resolves as a package on the mirror', async (t) => {
  const p = await pair(t);
  const { source, mirror } = p;
  source.config.keys[0].principal.repositories.push('dev');
  await p.settle();
  const built = await publishTo(source, 'dev', await upack('2.0.0'), 'app.upack');
  const registered = await source.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/dev/artifacts/${built}/package`,
    headers: source.headers,
  });
  assert.equal(registered.statusCode, 200, registered.body);
  // The promotion copies the registration within its transaction: the feed has no
  // package.register for it, only the received artifact.
  const promoted = await source.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/dev/artifacts/${built}/promote`,
    headers: source.headers,
    payload: { target: 'releases', stages: ['release'] },
  });
  assert.equal(promoted.statusCode, 201, promoted.body);
  await p.settle();
  const resolved = await call(mirror, 'GET', '/packages/resolve?group=&name=app&version=2.0.0');
  assert.ok(promoted.json().artifactId);
  assert.equal(resolved.json().artifactId, promoted.json().artifactId);
  const byStage = await call(mirror, 'GET', '/packages/resolve?group=&name=app&stage=release');
  assert.equal(byStage.json().artifactId, promoted.json().artifactId);
});

test('a mirror detached since is never followed again from its old position', async (t) => {
  const p = await pair(t);
  await publish(p.source, Buffer.from('before the detach'), 'a.bin');
  await p.settle();
  // A detach removes the configuration; the worker marks the state when it starts without it.
  const states = new PostgresMirrorState(p.catalog.pool);
  await states.markDetached([]);
  // Rolled back before anyone wrote here (a failed configure restores the files): it follows on.
  await p.settle();
  assert.equal((await call(p.mirror, 'GET', '/mirror')).json().errorCode, null);
  // Detached for real: the repository took a change of its own, so it never follows again.
  await states.markDetached([]);
  const [{ artifact_id: id }] = (
    await p.catalog.pool.query(
      "SELECT artifact_id FROM arkvory_audit WHERE repository='releases' LIMIT 1",
    )
  ).rows;
  await p.catalog.pool.query(
    `INSERT INTO arkvory_audit(repository, actor, action, artifact_id) VALUES('releases', 'operator', 'annotations.replace', $1)`,
    [id],
  );
  await assert.rejects(p.settle(), failsWith('mirror_detached'));
  assert.equal((await call(p.mirror, 'GET', '/mirror')).json().errorCode, 'mirror_detached');
});

test('a change made here before the worker wrote the detach mark still makes it final', async (t) => {
  const p = await pair(t);
  await publish(p.source, Buffer.from('before the detach'), 'a.bin');
  await p.settle();
  // The API took a write as soon as it ran without the mirror; the worker started later.
  const [{ artifact_id: id }] = (
    await p.catalog.pool.query(
      "SELECT artifact_id FROM arkvory_audit WHERE repository='releases' LIMIT 1",
    )
  ).rows;
  await p.catalog.pool.query(
    `INSERT INTO arkvory_audit(repository, actor, action, artifact_id, occurred_at)
     VALUES('releases', 'operator', 'annotations.replace', $1, now() - interval '1 minute')`,
    [id],
  );
  await new PostgresMirrorState(p.catalog.pool).markDetached([]);
  await assert.rejects(p.settle(), failsWith('mirror_detached'));
});

/** Entries put aside are retried ten minutes after their last attempt: make them due now. */
const due = (p) =>
  p.catalog.pool.query("UPDATE arkvory_mirror_conflicts SET last_at = last_at - interval '1 hour'");

test('a package version both sides claim is put aside; the import goes on and clears it once resolved', async (t) => {
  const p = await pair(t, ['release']);
  const { source: staging, mirror: prod } = p;
  // Production built app 1.0.0 itself; staging promotes another app 1.0.0.
  const own = await publish(prod, await upack('1.0.0'), 'app.upack');
  await call(prod, 'POST', `/artifacts/${own}/package`);
  await p.settle();
  const other = await publish(staging, Buffer.concat([await upack('1.0.0')]), 'app-other.upack');
  await call(staging, 'POST', `/artifacts/${other}/package`);
  await call(staging, 'PUT', `/artifacts/${other}/stages/release`, {});
  // A later promotion is not blocked by the conflicting one.
  const next = await publish(staging, await upack('2.0.0'), 'app-next.upack');
  await call(staging, 'POST', `/artifacts/${next}/package`);
  await call(staging, 'PUT', `/artifacts/${next}/stages/release`, {});
  await p.settle();
  const status = (await call(prod, 'GET', '/mirror')).json();
  assert.equal(status.errorCode, null, 'a conflict put aside is no stop');
  assert.equal(status.conflicts.count, 1);
  assert.ok(status.conflicts.oldestAt);
  assert.partialDeepStrictEqual(status.conflicts.sample, [
    {
      artifactId: other,
      action: 'stage.add',
      detail: 'release',
      code: 'mirror_package_conflict',
      attempts: 1,
    },
  ]);
  assert.equal(
    (await call(prod, 'GET', '/packages/resolve?group=&name=app&version=2.0.0')).json().artifactId,
    next,
  );
  // Clients still get production's own build, never the other bytes under its version.
  assert.equal(
    (await call(prod, 'GET', '/packages/resolve?group=&name=app&version=1.0.0')).json().artifactId,
    own,
  );
  const metrics = await prod.app.inject({ url: '/health/metrics', headers: prod.headers });
  assert.match(
    metrics.body,
    /^arkvory_mirror_conflicts\{repository="releases",mode="import"\} 1$/m,
  );
  // Staging withdraws the promotion: the next retry finds nothing to take and clears it.
  await call(staging, 'DELETE', `/artifacts/${other}/stages/release`, undefined, 204);
  await due(p);
  await p.settle();
  const cleared = (await call(prod, 'GET', '/mirror')).json();
  assert.deepEqual(cleared.conflicts, { count: 0, oldestAt: null, sample: [] });
  assert.equal(cleared.errorCode, null);
});

test('a copy that outlives its upload continues from its parts instead of starting over', async (t) => {
  const p = await pair(t);
  await p.settle();
  const large = randomBytes(17 * 1024 * 1024); // three parts
  const id = await publish(p.source, large, 'big.bin');
  await assert.rejects(p.make(p.counted(2).port).step(never), /connection lost/);
  // A week passes while the source is away: the copy's upload expires, still pending.
  await p.catalog.pool.query(
    "UPDATE arkvory_uploads SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [id],
  );
  const resumed = p.counted();
  await p.settle(resumed.port);
  assert.equal(resumed.counter.ranges, 2, 'only the two missing parts are fetched');
  assert.deepEqual(await content(p.mirror, `/artifacts/${id}/content`), large);
});

test('an artifact ID another repository holds here is put aside; the mirror goes on and takes it once free', async (t) => {
  const p = await pair(t);
  await p.settle();
  const bytes = Buffer.from('shared id');
  const id = await publish(p.source, bytes, 'a.bin');
  // Another repository here holds that ID (a second mirror of the same source, say).
  await p.catalog.pool.query(
    `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
     VALUES($1::uuid,'other','someone',$1::text,'{"name":"a.bin","size":"9","sha256":"x"}',9,'pending',now())`,
    [id],
  );
  const later = await publish(p.source, Buffer.from('after it'), 'b.bin');
  await p.settle();
  const status = (await call(p.mirror, 'GET', '/mirror')).json();
  assert.equal(status.errorCode, null);
  assert.equal(status.caughtUp, true, 'the feed went past the entry');
  assert.ok(status.conflicts.count >= 1);
  for (const entry of status.conflicts.sample) {
    assert.equal(entry.artifactId, id);
    assert.equal(entry.code, 'mirror_id_taken');
  }
  assert.deepEqual(await content(p.mirror, `/artifacts/${later}/content`), Buffer.from('after it'));
  // The other repository lets go of it: the retry copies it and clears every entry.
  await p.catalog.pool.query("DELETE FROM arkvory_uploads WHERE id=$1 AND repository='other'", [
    id,
  ]);
  await due(p);
  await p.settle();
  assert.equal((await call(p.mirror, 'GET', '/mirror')).json().conflicts.count, 0);
  assert.deepEqual(await content(p.mirror, `/artifacts/${id}/content`), bytes);
});

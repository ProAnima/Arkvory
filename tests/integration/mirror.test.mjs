import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { base } from './fixture.mjs';
import { call, content, key, never, pair, publish, upack } from './mirror-fixture.mjs';

test('a mirror seeds, follows the feed and serves artifacts, packages, paths and stages', async (t) => {
  const p = await pair(t);
  {
    const { source, mirror } = p;
    const small = Buffer.from('alpha');
    const large = randomBytes(9 * 1024 * 1024 + 17); // two parts of the 8 MiB layout
    const a = await publish(source, small, 'a.txt');
    const b = await publish(source, large, 'b.bin');
    const c = await publish(source, await upack('1.0.0'), 'app.upack');
    const x = await publish(source, Buffer.from('to be deleted'), 'x.txt');
    await call(source, 'POST', `/artifacts/${c}/package`);
    await call(source, 'PUT', `/artifacts/${a}/annotations`, {
      expectedRevision: 0,
      value: { labels: ['qa'], metadata: { build: '7' }, collections: ['nightly'] },
    });
    await call(source, 'PUT', '/asset', {
      path: 'tools/a.txt',
      artifactId: a,
      expectedRevision: 0,
    });
    await call(source, 'PUT', `/artifacts/${c}/stages/staging`, {});
    await p.settle();

    // Same IDs, bytes, annotations, path, package and stage on the mirror.
    assert.deepEqual(await content(mirror, `/artifacts/${b}/content`), large);
    assert.deepEqual(await content(mirror, '/asset/content?path=tools%2Fa.txt'), small);
    const annotations = (await call(mirror, 'GET', `/artifacts/${a}/annotations`)).json();
    assert.deepEqual(
      [annotations.labels, annotations.metadata, annotations.collections],
      [['qa'], { build: '7' }, ['nightly']],
    );
    const resolved = (
      await call(mirror, 'GET', '/packages/resolve?group=&name=app&version=1.0.0')
    ).json();
    assert.equal(resolved.artifactId, c);
    assert.deepEqual(resolved.stages, ['staging']);
    const status = (await call(mirror, 'GET', '/mirror')).json();
    assert.equal(status.phase, 'following');
    assert.equal(status.caughtUp, true);
    assert.equal(status.copiedArtifacts, 4);
    assert.equal(status.errorCode, null);
    // Prometheus sees the same state; the stale and failing alerts are built on these series.
    const metrics = await mirror.app.inject({ url: '/health/metrics', headers: mirror.headers });
    assert.match(
      metrics.body,
      /^arkvory_mirror_last_sync_timestamp_seconds\{repository="releases",mode="mirror"\} \d+$/m,
    );
    assert.match(
      metrics.body,
      /^arkvory_mirror_failing\{repository="releases",mode="mirror"\} 0$/m,
    );

    // Changes after the seed arrive through the feed, deletions included.
    await call(source, 'DELETE', `/artifacts/${c}/stages/staging`, undefined, 204);
    const d = await publish(source, Buffer.from('delta'), 'd.txt');
    await call(source, 'PUT', '/asset', {
      path: 'tools/a.txt',
      artifactId: d,
      expectedRevision: 1,
    });
    const removed = await source.app.inject({
      method: 'DELETE',
      url: `${base}/artifacts/${x}`,
      headers: await p.deleter(),
      payload: { expectedAnnotationRevision: 0 },
    });
    assert.equal(removed.json().outcome, 'deleted', removed.body);
    await p.settle();
    await call(mirror, 'GET', `/artifacts/${x}`, undefined, 404);
    assert.deepEqual((await call(mirror, 'GET', `/artifacts/${c}/stages`)).json().items, []);
    assert.deepEqual(
      await content(mirror, '/asset/content?path=tools%2Fa.txt'),
      Buffer.from('delta'),
    );
    // Clients cannot write into the mirror, whatever their grants.
    for (const [method, url, payload] of [
      [
        'POST',
        '/uploads',
        { name: 'x', size: '1', sha256: '0'.repeat(64), labels: [], metadata: {} },
      ],
      [
        'PUT',
        `/artifacts/${b}/annotations`,
        { expectedRevision: 0, value: { labels: [], metadata: {}, collections: [] } },
      ],
      ['PUT', `/artifacts/${b}/stages/prod`, {}],
    ]) {
      const response = await mirror.app.inject({
        method,
        url: `${base}${url}`,
        headers: { ...mirror.headers, 'idempotency-key': randomUUID() },
        payload,
      });
      assert.equal(response.statusCode, 409, `${method} ${url}`);
      assert.equal(response.json().reason, 'mirror_read_only', `${method} ${url}`);
    }
    // Discovery offers reads and hides every change, so the console shows no write actions.
    // Promotion stays: a copy from the mirror into an ordinary repository is allowed.
    const discovered = await mirror.app.inject({
      url: '/api/v1/operations?repository=releases&limit=100',
      headers: mirror.headers,
    });
    assert.equal(discovered.statusCode, 200, discovered.body);
    const ids = discovered.json().items.map((item) => item.operationId);
    assert.ok(ids.includes('downloadArtifact') && ids.includes('getRepositoryMirror'), ids.join());
    for (const id of ['createUpload', 'setAnnotations', 'setArtifactStage', 'deleteArtifact'])
      assert.ok(!ids.includes(id), id);
    // An ordinary repository is not a mirror.
    const plain = await mirror.app.inject({
      url: '/api/v1/repositories/other/mirror',
      headers: mirror.headers,
    });
    assert.notEqual(plain.statusCode, 200);
  }
});

test('an interrupted copy resumes from its recorded parts and the mirror outlives its source', async (t) => {
  const p = await pair(t);
  {
    const { source, mirror } = p;
    await p.settle();
    const large = randomBytes(17 * 1024 * 1024); // three parts
    const id = await publish(source, large, 'big.bin');
    const broken = p.counted(2);
    await assert.rejects(p.make(broken.port).step(never), /connection lost/);
    const recorded = await p.catalog.pool.query(
      'SELECT count(*)::int AS n FROM arkvory_parts WHERE upload_id=$1',
      [id],
    );
    assert.equal(recorded.rows[0].n, 1, 'the first part stays recorded');
    assert.equal((await call(mirror, 'GET', '/mirror')).json().errorCode, 'mirror_failed');
    const resumed = p.counted();
    await p.settle(resumed.port);
    assert.equal(resumed.counter.ranges, 2, 'only the two missing parts are fetched again');
    assert.deepEqual(await content(mirror, `/artifacts/${id}/content`), large);
    assert.equal((await call(mirror, 'GET', '/mirror')).json().errorCode, null);

    // Without its source the mirror keeps serving; the failed step is recorded.
    await assert.rejects(p.make(p.port('http://127.0.0.1:9')).step(never));
    assert.deepEqual(await content(mirror, `/artifacts/${id}/content`), large);
    assert.notEqual((await call(mirror, 'GET', '/mirror')).json().errorCode, null);
  }
});

test('a copy cancelled by cleanup while the source was away resumes; write grants still read', async (t) => {
  const p = await pair(t);
  const { source, mirror } = p;
  await p.settle();
  const large = randomBytes(17 * 1024 * 1024); // three parts
  const id = await publish(source, large, 'big.bin');
  await assert.rejects(p.make(p.counted(2).port).step(never), /connection lost/);
  // A week without the source: online cleanup cancels the expired upload and reclaims its parts.
  await p.catalog.pool.query(
    `UPDATE arkvory_uploads SET status='cancelled', cancelled_at=now(), reclaimed=true,
       temp_cleaned=true, expires_at=now()-interval '1 day' WHERE id=$1`,
    [id],
  );
  await p.settle();
  assert.deepEqual(await content(mirror, `/artifacts/${id}/content`), large);
  assert.equal((await call(mirror, 'GET', '/mirror')).json().errorCode, null);

  // Reading the journal needs a write grant of a file key; a mirror refuses writes, not reads.
  const audit = await call(mirror, 'GET', '/audit?after=0');
  assert.ok(audit.json().items.some((entry) => entry.artifactId === id));
  const push = await mirror.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...mirror.headers, 'idempotency-key': randomUUID() },
    payload: { name: 'x', size: '1', sha256: 'a'.repeat(64), labels: [], metadata: {} },
  });
  assert.equal(push.statusCode, 409);
  assert.equal(push.json().reason, 'mirror_read_only');
});

test('dev to prod: versions given the release stage are taken over once and stay', async (t) => {
  const p = await pair(t, ['release']);
  const { source: dev, mirror: prod } = p;
  const promoted = await publish(dev, Buffer.from('promoted build'), 'app-1.bin');
  const internal = await publish(dev, Buffer.from('internal build'), 'app-2.bin');
  await call(dev, 'PUT', `/artifacts/${promoted}/annotations`, {
    expectedRevision: 0,
    value: { labels: ['signed'], metadata: { commit: 'abc' }, collections: [] },
  });
  await call(dev, 'PUT', `/artifacts/${promoted}/stages/release`, {});
  await call(dev, 'PUT', `/artifacts/${internal}/stages/qa`, {});
  await p.settle();
  assert.deepEqual(
    await content(prod, `/artifacts/${promoted}/content`),
    Buffer.from('promoted build'),
  );
  assert.deepEqual(
    (await call(prod, 'GET', `/artifacts/${promoted}/stages`)).json().items.map((s) => s.stage),
    ['release'],
  );
  assert.deepEqual((await call(prod, 'GET', `/artifacts/${promoted}/annotations`)).json().labels, [
    'signed',
  ]);
  await call(prod, 'GET', `/artifacts/${internal}`, undefined, 404);

  // A later promotion arrives through the feed; the dev cleanup does not reach prod.
  await call(dev, 'PUT', `/artifacts/${internal}/stages/release`, {});
  await call(dev, 'DELETE', `/artifacts/${promoted}/stages/release`, undefined, 204);
  const removed = await dev.app.inject({
    method: 'DELETE',
    url: `${base}/artifacts/${promoted}`,
    headers: await p.deleter(),
    payload: { expectedAnnotationRevision: 1 },
  });
  assert.equal(removed.json().outcome, 'deleted', removed.body);
  await p.settle();
  assert.deepEqual(
    await content(prod, `/artifacts/${internal}/content`),
    Buffer.from('internal build'),
  );
  assert.deepEqual(
    await content(prod, `/artifacts/${promoted}/content`),
    Buffer.from('promoted build'),
  );
  assert.deepEqual(
    (await call(prod, 'GET', `/artifacts/${promoted}/stages`)).json().items.map((s) => s.stage),
    ['release'],
    'stage removal on dev does not reach prod',
  );

  // Prod is an ordinary repository: its own uploads work, and its deletions stick.
  await publish(prod, Buffer.from('prod hotfix'), 'hotfix.bin');
  await p.target.remove(internal);
  await call(dev, 'DELETE', `/artifacts/${internal}/stages/release`, undefined, 204);
  await call(dev, 'PUT', `/artifacts/${internal}/stages/release`, {});
  await p.settle();
  await call(prod, 'GET', `/artifacts/${internal}`, undefined, 404);
  const status = (await call(prod, 'GET', '/mirror')).json();
  assert.equal(status.mode, 'import');
  assert.deepEqual(status.stages, ['release']);
  assert.equal(status.copiedArtifacts, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ZipFile } from 'yazl';
import { createServer } from '../../apps/api/dist/index.js';
import { MirrorSync, StageImport } from '@proanima/arkvory-application';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresContentPins,
  PostgresMirrorState,
  migrate,
} from '@proanima/arkvory-infrastructure';
import { SdkMirrorSource } from '../../apps/worker/dist/mirror-source.js';
import { ServiceMirrorTarget } from '../../apps/worker/dist/mirror-target.js';
import { setup, base } from './fixture.mjs';
import { dropTestDatabase, removeTestDirectory } from '../helpers.mjs';

const never = { throwIfAborted() {} };

async function upack(version) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({ name: 'app', version })), 'upack.json');
  zip.addBuffer(Buffer.from('build ' + version), 'package/build.txt');
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Publishes bytes on an instance with its writer key through a single content upload. */
async function publish(f, bytes, name = 'file.bin') {
  const created = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
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
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

const call = async (f, method, url, payload, expected = 200) => {
  const response = await f.app.inject({
    method,
    url: `${base}${url}`,
    headers: f.headers,
    payload,
  });
  assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
  return response;
};

const key = (id, permissions, administrator = false) => {
  const token = `${id}-${randomUUID()}${randomUUID()}`;
  const sha256 = createHash('sha256').update(token).digest('hex');
  return {
    token,
    entry: { sha256, principal: { id, repositories: ['releases'], permissions, administrator } },
  };
};

/**
 * The mirror installation in its own database: advisory locks of the writer are database-wide,
 * so a second writer cannot share the source's database (other schemas or not). One cleanup in
 * the right order: server, pools, then the database and the storage directory.
 */
async function mirrorInstance(t, upstream, stages) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('ARKVORY_TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  const name = `${url.pathname.slice(1)}_mirror_${randomBytes(6).toString('hex')}`;
  assert.match(name, /^[a-z0-9_]{1,63}$/);
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  url.pathname = '/' + name;
  url.searchParams.delete('options');
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-mirror-'));
  const writer = key('mirror-writer', ['read', 'write'], true);
  const reader = key('mirror-reader', ['read']);
  const config = {
    databaseUrl: url.toString(),
    dataDirectory: directory,
    host: '127.0.0.1',
    port: 0,
    capacityBytes: 16 * 1024 ** 3,
    maxUploads: 2,
    maxDownloads: 2,
    keys: [writer.entry, reader.entry],
    mirrors: [
      {
        repository: 'releases',
        upstream,
        sourceRepository: 'releases',
        ...(stages ? { stages } : {}),
      },
    ],
  };
  const migrations = new PostgresCatalog(config.databaseUrl, 0, 1);
  const closers = [() => migrations.close()];
  t.after(async () => {
    try {
      for (const close of closers.reverse()) await close();
    } finally {
      await dropTestDatabase(admin, name);
      await admin.end();
      await removeTestDirectory(directory);
    }
  });
  await migrate(migrations.pool);
  const app = await createServer(config);
  closers.push(() => app.close());
  return {
    app,
    config,
    directory,
    headers: { authorization: `Bearer ${writer.token}` },
    readerHeaders: { authorization: `Bearer ${reader.token}` },
    release: (close) => closers.push(close),
  };
}

/** Source and mirror installations; the mirror's worker side is driven step by step. */
async function pair(t, stages) {
  const source = await setup(t);
  const upstream = await source.listen();
  const mirror = await mirrorInstance(t, upstream, stages);
  const blobs = new LocalBlobStore(mirror.directory, 0);
  const catalog = new PostgresCatalog(mirror.config.databaseUrl, mirror.config.capacityBytes, 2);
  const stop = new AbortController();
  const pins = new PostgresContentPins(catalog.pool);
  mirror.release(async () => {
    stop.abort();
    await pins.close();
    await catalog.close();
  });
  await catalog.claimStorage(await blobs.identity(), 'worker');
  const reader = source.readerHeaders.authorization.slice(7);
  const target = new ServiceMirrorTarget('releases', catalog, blobs, mirror.directory, pins);
  const make = (upstreamSource) => {
    const dependencies = {
      repository: 'releases',
      source: [upstream, 'releases', ...(stages ?? [])].join('|'),
      upstream: upstreamSource,
      target,
      states: new PostgresMirrorState(catalog.pool),
      now: () => new Date().toISOString(),
    };
    return stages ? new StageImport({ ...dependencies, stages }) : new MirrorSync(dependencies);
  };
  const port = (address) => new SdkMirrorSource(address, 'releases', () => reader, stop.signal);
  const sourcePort = port(upstream);
  /** The source port with counted range reads; `fail` names the call (1-based) that breaks. */
  const counted = (fail = 0) => {
    const counter = { ranges: 0 };
    const methods = ['changes', 'artifacts', 'packages', 'assets', 'artifact', 'annotation'];
    const wrapped = Object.fromEntries(
      [...methods, 'stages', 'asset'].map((name) => [name, (...args) => sourcePort[name](...args)]),
    );
    wrapped.content = async (...args) => {
      if (++counter.ranges === fail) throw new Error('connection lost');
      return sourcePort.content(...args);
    };
    return { counter, port: wrapped };
  };
  // A fresh synchronization per phase, as after a worker restart: state comes from the database.
  const settle = async (upstreamSource = sourcePort) => {
    const worker = make(upstreamSource);
    for (let step = 0; step < 200; step++) if ((await worker.step(never)) === 'idle') return;
    throw new Error('The mirror did not catch up');
  };
  /** Deletions need a managed key with artifact.delete, issued by the bootstrap key. */
  const deleter = async () => {
    source.config.keys[0].principal.serviceAdministrator = true;
    const root = new ArkvoryClient(upstream, () => source.headers.authorization.slice(7));
    const bindings = [
      { resource: { kind: 'repository', id: 'releases' }, actions: ['artifact.delete'] },
    ];
    const account = await root.createServiceAccount('mirror-test-deleter', bindings);
    const issued = await root.issueServiceKey(account.id, 'issue-deleter', {
      name: 'deleter',
      bindings,
    });
    await new ArkvoryClient(upstream, () => issued.secret).activateServiceKey();
    return { authorization: 'Bearer ' + issued.secret };
  };
  return { source, mirror, catalog, target, port, counted, make, settle, deleter };
}

const content = async (f, url) => {
  const response = await f.app.inject({ url: `${base}${url}`, headers: f.readerHeaders });
  assert.equal(response.statusCode, 200, response.body);
  return response.rawPayload;
};

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

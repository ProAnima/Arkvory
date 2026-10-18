import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { ZipFile } from 'yazl';
import {
  ArtifactCatalog,
  GlobalSearch,
  ScopedCatalog,
  StorageService,
} from '@proanima/arkvory-application';
import {
  AccessScopes,
  PostgresBrowse,
  PostgresContentPins,
  PostgresGlobalSearch,
  ZipManifestReader,
  localStorageBackends,
  moduleCatalog,
} from '@proanima/arkvory-infrastructure';
import { catalogReadContract } from '../../packages/extension-testkit/dist/index.js';
import { setup } from './fixture.mjs';

// `catalog-read` and `content-read` (ADR 0083, N4) through the use cases of /api/v1 on
// PostgreSQL: no existence oracle, intersections, bounds and pinned content.
const writer = 'catalog-writer-' + randomUUID() + randomUUID();
const keys = [
  {
    sha256: createHash('sha256').update(writer).digest('hex'),
    principal: {
      id: 'catalog-writer',
      repositories: ['releases', 'other'],
      permissions: ['read', 'write'],
      administrator: true,
    },
  },
];
const headers = { authorization: `Bearer ${writer}` };
const reader = {
  credential: 'file-key',
  id: 'reader',
  repositories: ['releases'],
  permissions: ['read'],
};
const stranger = {
  credential: 'file-key',
  id: 'stranger',
  repositories: ['elsewhere'],
  permissions: ['read'],
};
// A service key that may list and read artifacts, but neither annotations nor content.
const lister = {
  credential: 'service-key',
  id: 'service:lister',
  repositories: [],
  permissions: [],
  managed: {
    accountId: randomUUID(),
    keyId: randomUUID(),
    bindings: [
      {
        resource: { kind: 'repository', id: 'releases' },
        actions: ['artifact.read', 'artifact.list'],
      },
    ],
  },
};

async function upack(name) {
  const zip = new ZipFile();
  const at = { mtime: new Date('2026-01-01T00:00:00Z') };
  zip.addBuffer(
    Buffer.from(JSON.stringify({ group: 'tools', name, version: '1.0.0' })),
    'upack.json',
    at,
  );
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function publish(f, repository, bytes, { complete = true } = {}) {
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repository}/uploads`,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      name: 'tool.upack',
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: ['ci'],
      metadata: { commit: 'abc' },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  if (!complete) return id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repository}/uploads/${id}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  return id;
}

async function call(f, method, url, payload) {
  const response = await f.app.inject({ method, url, headers, payload });
  assert.equal(response.statusCode, 200, response.body);
}

async function harness(t) {
  const f = await setup(t, { keys });
  const bytes = await upack('tool');
  const id = await publish(f, 'releases', bytes);
  await call(f, 'POST', `/api/v1/repositories/releases/artifacts/${id}/package`);
  await call(f, 'PUT', '/api/v1/repositories/releases/asset', {
    path: 'tools/current.upack',
    artifactId: id,
    expectedRevision: 0,
  });
  const pending = await publish(f, 'releases', await upack('pending'), { complete: false });
  const foreign = await publish(f, 'other', await upack('foreign'));
  const blobs = localStorageBackends(f.directory, 0, []);
  // A pool of its own: the fixture closes its pools first, and a held pin would keep them open.
  const pool = new Pool({ connectionString: f.config.databaseUrl });
  const pins = new PostgresContentPins(pool);
  t.after(async () => {
    await pins.close();
    await pool.end();
  });
  const storage = new StorageService(f.catalog, blobs, {
    next: randomUUID,
    now: () => new Date().toISOString(),
  });
  const browse = new ArtifactCatalog(
    storage,
    new PostgresBrowse(f.catalog.pool),
    new ZipManifestReader(blobs, pins),
  );
  const search = new GlobalSearch(new PostgresGlobalSearch(f.catalog.pool));
  const scopes = new AccessScopes();
  const { catalog, content } = moduleCatalog(
    new ScopedCatalog(storage, browse, search, pins),
    scopes,
  );
  return {
    catalog,
    content,
    repository: 'releases',
    reader: scopes.of([reader]),
    lister: scopes.of([lister]),
    stranger: scopes.of([stranger]),
    published: { id, bytes: new Uint8Array(bytes) },
    pending,
    absent: randomUUID(),
    foreign: { repository: 'other', id: foreign },
    packageName: { group: 'tools', name: 'tool' },
    assetPath: 'tools/current.upack',
  };
}

catalogReadContract('core use cases on PostgreSQL', harness);

test('malformed input is invalid_input for every scope, never a hint of existence', async (t) => {
  const h = await harness(t);
  for (const scope of [h.reader, h.stranger])
    for (const call of [
      () => h.catalog.artifact(scope, h.repository, 'not-an-id'),
      () => h.catalog.artifact(scope, 'Bad Repo', h.published.id),
      () => h.catalog.asset(scope, h.repository, '../escape'),
      () => h.content.open(scope, { repository: h.repository, id: 'x' }),
    ])
      await assert.rejects(call(), { code: 'invalid_input' });
});

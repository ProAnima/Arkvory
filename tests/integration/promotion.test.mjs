import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ZipFile } from 'yazl';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
import { PostgresRetention } from '@proanima/arkvory-infrastructure';

const token = 'promote-' + randomUUID() + randomUUID();
const reader = 'promote-read-' + randomUUID() + randomUUID();
const keys = [
  {
    sha256: createHash('sha256').update(token).digest('hex'),
    principal: {
      id: 'promoter',
      repositories: ['dev', 'prod'],
      permissions: ['read', 'write'],
      administrator: true,
    },
  },
  {
    sha256: createHash('sha256').update(reader).digest('hex'),
    principal: { id: 'viewer', repositories: ['dev', 'prod'], permissions: ['read'] },
  },
];
const auth = { authorization: `Bearer ${token}` };
const readOnly = { authorization: `Bearer ${reader}` };

// A fixed entry time keeps equal inputs byte-identical; yazl defaults to the current clock.
const entryTime = { mtime: new Date('2026-01-01T00:00:00Z') };
async function upack(manifest, extra = '') {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'upack.json', entryTime);
  zip.addBuffer(Buffer.from('payload ' + extra), 'package/readme.txt', entryTime);
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function publish(f, repository, bytes, { register = true, name = 'build.upack' } = {}) {
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repository}/uploads`,
    headers: { ...auth, 'idempotency-key': randomUUID() },
    payload: {
      name,
      size: String(bytes.length),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      labels: ['ci'],
      metadata: { commit: 'abc' },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repository}/uploads/${id}/content`,
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  if (register) {
    const registered = await f.app.inject({
      method: 'POST',
      url: `/api/v1/repositories/${repository}/artifacts/${id}/package`,
      headers: auth,
    });
    assert.equal(registered.statusCode, 200, registered.body);
  }
  return id;
}
const call = (f, method, url, payload, headers = auth) =>
  f.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });

test('stages are controlled labels with idempotent changes, history and retention protection', async (t) => {
  const f = await setup(t, { keys });
  const id = await publish(f, 'dev', await upack({ name: 'app', version: '1.0.0' }));
  const base = `/api/v1/repositories/dev/artifacts/${id}`;
  assert.equal((await call(f, 'PUT', `${base}/stages/qa`, {}, readOnly)).statusCode, 403);
  const first = await call(f, 'PUT', `${base}/stages/qa`, { comment: 'smoke passed' });
  assert.equal(first.statusCode, 200, first.body);
  validateResponse('/api/v1/repositories/{repository}/artifacts/{id}/stages/{stage}', 'put', first);
  const again = await call(f, 'PUT', `${base}/stages/qa`, { comment: 'ignored' });
  assert.equal(again.json().promotedAt, first.json().promotedAt);
  assert.equal(again.json().comment, 'smoke passed');
  assert.equal((await call(f, 'PUT', `${base}/stages/QA`, {})).statusCode, 400);
  assert.equal((await call(f, 'PUT', `${base}/stages/beta`)).statusCode, 200);
  const listed = await call(f, 'GET', `${base}/stages`, undefined, readOnly);
  assert.deepEqual(
    listed.json().items.map((s) => s.stage),
    ['beta', 'qa'],
  );
  assert.equal((await call(f, 'DELETE', `${base}/stages/qa`)).statusCode, 204);
  assert.equal((await call(f, 'DELETE', `${base}/stages/qa`)).statusCode, 204);
  const history = await call(f, 'GET', `${base}/promotions`);
  validateResponse('/api/v1/repositories/{repository}/artifacts/{id}/promotions', 'get', history);
  assert.deepEqual(
    history.json().items.map((e) => `${e.action}:${e.stage}`),
    ['stage.added:qa', 'stage.added:beta', 'stage.removed:qa'],
  );
  const staged = await call(f, 'GET', '/api/v1/repositories/dev/stages?stage=beta');
  validateResponse('/api/v1/repositories/{repository}/stages', 'get', staged);
  assert.deepEqual(
    staged.json().items.map((s) => s.artifactId),
    [id],
  );
  for (let i = 0; i < 15; i++) await call(f, 'PUT', `${base}/stages/s${String(i)}`);
  assert.equal((await call(f, 'PUT', `${base}/stages/overflow`)).statusCode, 409);
  const retention = new PostgresRetention(f.catalog.pool);
  assert.deepEqual((await retention.inspect('dev', id)).blockers, ['promotion_stage']);
});

test('copy promotion shares bytes, metadata and identity and is idempotent', async (t) => {
  const f = await setup(t, { keys });
  const bytes = await upack({ group: 'tools', name: 'app', version: '1.2.0' });
  const id = await publish(f, 'dev', bytes);
  const promote = (payload) =>
    call(f, 'POST', `/api/v1/repositories/dev/artifacts/${id}/promote`, payload);
  assert.equal((await promote({ target: 'dev' })).statusCode, 400);
  assert.equal(
    (
      await call(
        f,
        'POST',
        `/api/v1/repositories/dev/artifacts/${id}/promote`,
        { target: 'prod' },
        readOnly,
      )
    ).statusCode,
    403,
  );
  const created = await promote({ target: 'prod', stages: ['prod'], comment: 'release 1.2' });
  assert.equal(created.statusCode, 201, created.body);
  validateResponse('/api/v1/repositories/{repository}/artifacts/{id}/promote', 'post', created);
  const copy = created.json();
  assert.equal(copy.repository, 'prod');
  assert.notEqual(copy.artifactId, id);
  assert.deepEqual(copy.stages, ['prod']);
  const repeated = await promote({ target: 'prod' });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().artifactId, copy.artifactId);
  assert.equal(repeated.json().created, false);
  const download = await call(
    f,
    'GET',
    `/api/v1/repositories/prod/artifacts/${copy.artifactId}/content`,
  );
  assert.deepEqual(download.rawPayload, bytes);
  const annotations = await call(
    f,
    'GET',
    `/api/v1/repositories/prod/artifacts/${copy.artifactId}/annotations`,
  );
  assert.deepEqual(annotations.json().labels, ['ci']);
  const packages = await call(f, 'GET', '/api/v1/repositories/prod/packages?group=tools&name=app');
  assert.deepEqual(
    packages.json().items.map((p) => p.artifactId),
    [copy.artifactId],
  );
  assert.equal((await call(f, 'GET', `/api/v1/repositories/dev/artifacts/${id}`)).statusCode, 200);
  const journal = await call(f, 'GET', '/api/v1/repositories/prod/promotions');
  validateResponse('/api/v1/repositories/{repository}/promotions', 'get', journal);
  assert.deepEqual(
    journal.json().items.map((e) => e.action),
    ['stage.added', 'received'],
  );
  // Removing the source copy does not affect the promoted bytes.
  await f.catalog.pool.query("UPDATE arkvory_uploads SET status='cancelled' WHERE id=$1", [id]);
  const after = await call(
    f,
    'GET',
    `/api/v1/repositories/prod/artifacts/${copy.artifactId}/content`,
  );
  assert.deepEqual(after.rawPayload, bytes);
});

test('move retires the source atomically, carries stages and honors deletion blockers', async (t) => {
  const f = await setup(t, { keys });
  const id = await publish(f, 'dev', await upack({ name: 'svc', version: '2.0.0' }));
  await call(f, 'PUT', `/api/v1/repositories/dev/artifacts/${id}/stages/qa`);
  const moved = await call(f, 'POST', `/api/v1/repositories/dev/artifacts/${id}/promote`, {
    target: 'prod',
    mode: 'move',
    stages: ['release'],
  });
  assert.equal(moved.statusCode, 201, moved.body);
  assert.deepEqual(moved.json().stages, ['qa', 'release']);
  assert.equal((await call(f, 'GET', `/api/v1/repositories/dev/artifacts/${id}`)).statusCode, 404);
  const resolved = await call(
    f,
    'GET',
    '/api/v1/repositories/prod/packages/resolve?name=svc&stage=release',
  );
  assert.equal(resolved.json().artifactId, moved.json().artifactId);

  const pinned = await publish(f, 'dev', await upack({ name: 'lib', version: '1.0.0' }));
  await call(f, 'PUT', '/api/v1/repositories/dev/asset', {
    path: 'current/lib.upack',
    artifactId: pinned,
    expectedRevision: 0,
  });
  const refused = await call(f, 'POST', `/api/v1/repositories/dev/artifacts/${pinned}/promote`, {
    target: 'prod',
    mode: 'move',
  });
  assert.equal(refused.statusCode, 409, refused.body);
  const leaked = await call(f, 'GET', '/api/v1/repositories/prod/packages?name=lib');
  assert.deepEqual(leaked.json().items, []);
  assert.equal(
    (await call(f, 'GET', `/api/v1/repositories/dev/artifacts/${pinned}`)).statusCode,
    200,
  );
});

test('identity conflicts in the target are rejected unless the bytes are identical', async (t) => {
  const f = await setup(t, { keys });
  const original = await upack({ name: 'app', version: '3.0.0' }, 'dev');
  const id = await publish(f, 'dev', original);
  await publish(f, 'prod', await upack({ name: 'app', version: '3.0.0' }, 'other'));
  const conflict = await call(f, 'POST', `/api/v1/repositories/dev/artifacts/${id}/promote`, {
    target: 'prod',
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  const twin = await upack({ name: 'twin', version: '1.0.0' }, 'x');
  const same = await publish(f, 'dev', twin);
  const existing = await publish(f, 'prod', twin);
  const adopted = await call(f, 'POST', `/api/v1/repositories/dev/artifacts/${same}/promote`, {
    target: 'prod',
    stages: ['prod'],
  });
  assert.equal(adopted.statusCode, 200, adopted.body);
  assert.equal(adopted.json().artifactId, existing);
  assert.equal(adopted.json().created, false);
});

test('resolve and named download select versions by range, stage, prerelease and promotion time', async (t) => {
  const f = await setup(t, { keys });
  const ids = {};
  for (const version of ['1.0.0', '1.1.0', '1.2.0-rc.1', '2.0.0'])
    ids[version] = await publish(f, 'dev', await upack({ name: 'game', version }, version));
  const stage = (version, name) =>
    call(f, 'PUT', `/api/v1/repositories/dev/artifacts/${ids[version]}/stages/${name}`);
  await stage('1.0.0', 'prod');
  await stage('1.1.0', 'prod');
  await stage('1.0.0', 'prod');
  const resolve = async (query, expected) => {
    const response = await call(f, 'GET', `/api/v1/repositories/dev/packages/resolve?${query}`);
    assert.equal(response.statusCode, expected ? 200 : 404, `${query}: ${response.body}`);
    if (expected) {
      validateResponse('/api/v1/repositories/{repository}/packages/resolve', 'get', response);
      assert.equal(response.json().version, expected, query);
    }
    return response;
  };
  await resolve('name=game', '2.0.0');
  await resolve('name=game&range=%5E1.0', '1.1.0');
  await resolve('name=game&range=%5E1.0&prerelease=true', '1.2.0-rc.1');
  await resolve('name=game&range=%3E%3D3', null);
  await resolve('name=GAME&version=1.0.0', '1.0.0');
  await resolve('name=game&stage=prod', '1.1.0');
  // Re-adding keeps the first promotion time, so 1.1.0 stays the latest promoted version.
  await resolve('name=game&stage=prod&order=promoted', '1.1.0');
  await call(f, 'DELETE', `/api/v1/repositories/dev/artifacts/${ids['1.1.0']}/stages/prod`);
  await resolve('name=game&stage=prod&order=promoted', '1.0.0');
  assert.equal(
    (await call(f, 'GET', '/api/v1/repositories/dev/packages/resolve?name=game&order=promoted'))
      .statusCode,
    400,
  );
  const content = await call(
    f,
    'GET',
    '/api/v1/repositories/dev/packages/content?name=game&stage=prod',
  );
  assert.equal(content.statusCode, 200);
  assert.equal(content.headers['x-arkvory-package-version'], '1.0.0');
  assert.equal(content.headers['x-arkvory-artifact-id'], ids['1.0.0']);
  const readerView = await call(
    f,
    'GET',
    '/api/v1/repositories/dev/packages/resolve?name=game',
    undefined,
    readOnly,
  );
  assert.equal(readerView.statusCode, 200);
});

test('stage listing filters a batch of artifact ids and validates them', async (t) => {
  const f = await setup(t, { keys });
  const first = await publish(f, 'dev', await upack({ name: 'one', version: '1.0.0' }));
  const second = await publish(f, 'dev', await upack({ name: 'two', version: '1.0.0' }));
  const third = await publish(f, 'dev', await upack({ name: 'three', version: '1.0.0' }));
  for (const id of [first, second, third])
    await call(f, 'PUT', `/api/v1/repositories/dev/artifacts/${id}/stages/qa`);
  const batch = await call(f, 'GET', `/api/v1/repositories/dev/stages?ids=${first},${third}`);
  assert.equal(batch.statusCode, 200, batch.body);
  assert.deepEqual(
    batch
      .json()
      .items.map((s) => s.artifactId)
      .sort(),
    [first, third].sort(),
  );
  for (const ids of ['not-a-uuid', '', Array.from({ length: 101 }, () => first).join(',')])
    assert.equal(
      (await call(f, 'GET', `/api/v1/repositories/dev/stages?ids=${ids}`)).statusCode,
      400,
      ids.slice(0, 20),
    );
});

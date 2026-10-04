import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { pair } from './mirror-fixture.mjs';

const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const basic = (headers) =>
  `Basic ${Buffer.from(`ci:${headers.authorization.slice(7)}`).toString('base64')}`;
const imageType = 'application/vnd.oci.image.manifest.v1+json';

/** Registry requests on one installation, authenticated like `docker login` with `headers`. */
const registry = (f, headers) => (method, path, payload, contentType) =>
  f.app.inject({
    method,
    url: `/v2/releases/${path}`,
    headers: {
      authorization: basic(headers),
      ...(contentType ? { 'content-type': contentType } : {}),
    },
    ...(payload ? { payload } : {}),
  });

async function pushBlob(push, image, bytes) {
  const digest = digestOf(bytes);
  const done = await push(
    'POST',
    `${image}/blobs/uploads/?digest=${digest}`,
    bytes,
    'application/octet-stream',
  );
  assert.equal(done.statusCode, 201, done.body);
  return digest;
}
/** An image of one layer; the manifest goes in under `reference` (a tag or its digest). */
async function pushImage(push, image, references) {
  const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux' }));
  const layer = randomBytes(40 * 1024);
  const blob = async (bytes, mediaType) => ({
    mediaType,
    digest: await pushBlob(push, image, bytes),
    size: bytes.length,
  });
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: imageType,
      config: await blob(config, 'application/vnd.oci.image.config.v1+json'),
      layers: [await blob(layer, 'application/vnd.oci.image.layer.v1.tar')],
    }),
  );
  for (const reference of references) {
    const stored = await push(
      'PUT',
      `${image}/manifests/${reference ?? digestOf(manifest)}`,
      manifest,
      imageType,
    );
    assert.equal(stored.statusCode, 201, stored.body);
  }
  return { manifest, layer, digest: digestOf(manifest) };
}

test('images pushed to the source pull from the mirror; deletions there follow', async (t) => {
  const { source, mirror, settle, deleter } = await pair(t);
  const push = registry(source, source.headers);
  const pull = registry(mirror, mirror.readerHeaders);
  // Before the seed: the mirror learns these from the registry entries of the feed.
  const first = await pushImage(push, 'team/web', ['1.0', 'old']);
  await settle();
  // After the seed: followed like any other change.
  const second = await pushImage(push, 'team/web', ['2.0']);
  await settle();

  for (const [reference, image] of [
    ['1.0', first],
    ['old', first],
    ['2.0', second],
    [second.digest, second],
  ]) {
    const pulled = await pull('GET', `team/web/manifests/${reference}`);
    assert.equal(pulled.statusCode, 200, `${reference}: ${pulled.body}`);
    assert.equal(pulled.headers['docker-content-digest'], image.digest);
    assert.deepEqual(pulled.rawPayload, image.manifest);
  }
  const layer = await pull('GET', `team/web/blobs/${digestOf(first.layer)}`);
  assert.equal(layer.statusCode, 200);
  assert.deepEqual(layer.rawPayload, first.layer);
  assert.deepEqual((await pull('GET', 'team/web/tags/list')).json().tags, ['1.0', '2.0', 'old']);

  // The mirror is read-only for clients, also through the registry (Arkvory's 409, OCI's code).
  const refused = await registry(mirror, mirror.headers)('POST', 'team/web/blobs/uploads/');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().errors[0].code, 'DENIED');

  // A removed tag and a removed manifest disappear from the mirror as well.
  const remove = registry(source, await deleter());
  assert.equal((await remove('DELETE', 'team/web/manifests/old')).statusCode, 202);
  assert.equal((await remove('DELETE', `team/web/manifests/${second.digest}`)).statusCode, 202);
  await settle();
  assert.deepEqual((await pull('GET', 'team/web/tags/list')).json().tags, ['1.0']);
  const gone = await pull('GET', `team/web/manifests/${second.digest}`);
  assert.equal(gone.statusCode, 404);
  assert.equal(gone.json().errors[0].code, 'MANIFEST_UNKNOWN');

  // The mirror journals its own registry rows: a mirror of this mirror follows the images too.
  const feed = await mirror.app.inject({
    url: '/api/v1/repositories/releases/changes?after=0&limit=100',
    headers: mirror.readerHeaders,
  });
  const actions = feed.json().items.map((item) => item.action);
  for (const action of ['oci.blob', 'oci.manifest', 'oci.tag', 'oci.tag.delete'])
    assert.ok(actions.includes(action), `${action} in ${actions.join()}`);
});

/** An LFS object through the batch API and the basic transfer, as git-lfs uploads it. */
async function pushLfs(f, bytes) {
  const oid = createHash('sha256').update(bytes).digest('hex');
  const stored = await f.app.inject({
    method: 'PUT',
    url: `/lfs/releases/objects/${oid}`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return oid;
}

test('Git LFS objects reach the mirror before and after its seed', async (t) => {
  const { source, mirror, settle } = await pair(t);
  const before = randomBytes(300 * 1024);
  const early = await pushLfs(source, before);
  await settle();
  const after = randomBytes(200 * 1024);
  const late = await pushLfs(source, after);
  await settle();
  for (const [oid, bytes] of [
    [early, before],
    [late, after],
  ]) {
    const batch = await mirror.app.inject({
      method: 'POST',
      url: '/lfs/releases/objects/batch',
      headers: { ...mirror.readerHeaders, 'content-type': 'application/vnd.git-lfs+json' },
      payload: JSON.stringify({ operation: 'download', objects: [{ oid, size: bytes.length }] }),
    });
    assert.ok(batch.json().objects[0].actions.download, batch.body);
    const object = await mirror.app.inject({
      url: `/lfs/releases/objects/${oid}`,
      headers: mirror.readerHeaders,
    });
    assert.deepEqual(object.rawPayload, bytes);
  }
  // A mirror is read-only for LFS uploads too.
  const refused = await mirror.app.inject({
    method: 'PUT',
    url: `/lfs/releases/objects/${early}`,
    headers: { ...mirror.headers, 'content-type': 'application/octet-stream' },
    payload: before,
  });
  assert.equal(refused.statusCode, 409);
});

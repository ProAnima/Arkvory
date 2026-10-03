import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { OciRegistry } from '@proanima/arkvory-application';
import { FileOciStaging, PostgresOciIndex } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';

const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const basic = (secret, user = 'ci') =>
  `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
const imageType = 'application/vnd.oci.image.manifest.v1+json';
const indexType = 'application/vnd.oci.image.index.v1+json';

async function registry(t) {
  const f = await setup(t);
  const url = await f.listen();
  const as =
    (authorization) =>
    (path, init = {}) =>
      fetch(url + path, {
        ...init,
        headers: { ...(authorization ? { authorization } : {}), ...init.headers },
      });
  return {
    f,
    url,
    call: as(basic(f.headers.authorization.slice(7))),
    reader: as(basic(f.readerHeaders.authorization.slice(7))),
    anonymous: as(undefined),
    as,
  };
}
async function errorOf(response) {
  const body = await response.json();
  return body.errors[0].code;
}
/** Docker's sequence: a session, one PATCH per chunk with Content-Range, PUT with the digest. */
async function pushBlob(call, name, bytes, chunks = 1) {
  const started = await call(`/v2/${name}/blobs/uploads/`, { method: 'POST' });
  assert.equal(started.status, 202, await started.clone().text());
  assert.equal(started.headers.get('docker-distribution-api-version'), 'registry/2.0');
  let location = started.headers.get('location');
  const step = Math.ceil(bytes.length / chunks);
  for (let offset = 0; offset < bytes.length; offset += step) {
    const chunk = bytes.subarray(offset, offset + step);
    const patched = await call(location, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `${String(offset)}-${String(offset + chunk.length - 1)}`,
      },
      body: chunk,
    });
    assert.equal(patched.status, 202, await patched.clone().text());
    assert.equal(patched.headers.get('range'), `0-${String(offset + chunk.length - 1)}`);
    location = patched.headers.get('location');
  }
  const digest = digestOf(bytes);
  const done = await call(`${location}?digest=${digest}`, { method: 'PUT' });
  assert.equal(done.status, 201, await done.clone().text());
  assert.equal(done.headers.get('docker-content-digest'), digest);
  return digest;
}
const descriptor = (mediaType, bytes) => ({
  mediaType,
  digest: digestOf(bytes),
  size: bytes.length,
});
function imageManifest(config, layers) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: imageType,
      config: descriptor('application/vnd.oci.image.config.v1+json', config),
      layers: layers.map((layer) => descriptor('application/vnd.oci.image.layer.v1.tar', layer)),
    }),
  );
}
async function putManifest(call, name, reference, bytes, type = imageType) {
  return call(`/v2/${name}/manifests/${reference}`, {
    method: 'PUT',
    headers: { 'content-type': type },
    body: bytes,
  });
}
async function pushImage(call, name, tag) {
  const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux' }));
  const layer = randomBytes(300 * 1024);
  await pushBlob(call, name, config);
  await pushBlob(call, name, layer, 3);
  const manifest = imageManifest(config, [layer]);
  const stored = await putManifest(call, name, tag, manifest);
  assert.equal(stored.status, 201, await stored.clone().text());
  return { config, layer, manifest, digest: digestOf(manifest) };
}

test('docker login handshake, then an image pushed in chunks pulls back intact', async (t) => {
  const { call, reader, anonymous } = await registry(t);
  const challenge = await anonymous('/v2/');
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate'), /^Basic realm="Arkvory"/);
  assert.equal(challenge.headers.get('docker-distribution-api-version'), 'registry/2.0');
  assert.equal(await errorOf(challenge), 'UNAUTHORIZED');
  const wrong = await anonymous('/v2/', { headers: { authorization: basic('x'.repeat(40)) } });
  assert.equal(wrong.status, 401);
  const version = await call('/v2/');
  assert.equal(version.status, 200);
  assert.deepEqual(await version.json(), {});

  const name = 'releases/team/web';
  const image = await pushImage(call, name, 'v1');
  const head = await reader(`/v2/${name}/blobs/${digestOf(image.layer)}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(image.layer.length));
  assert.equal(head.headers.get('docker-content-digest'), digestOf(image.layer));
  const part = await reader(`/v2/${name}/blobs/${digestOf(image.layer)}`, {
    headers: { range: 'bytes=100-199' },
  });
  assert.equal(part.status, 206);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), image.layer.subarray(100, 200));

  for (const reference of ['v1', image.digest]) {
    const pulled = await reader(`/v2/${name}/manifests/${reference}`);
    assert.equal(pulled.status, 200, reference);
    assert.equal(pulled.headers.get('content-type'), imageType);
    assert.equal(pulled.headers.get('docker-content-digest'), image.digest);
    assert.deepEqual(Buffer.from(await pulled.arrayBuffer()), image.manifest);
  }
  const tags = await reader(`/v2/${name}/tags/list`);
  assert.deepEqual(await tags.json(), { name, tags: ['v1'] });

  // Pushing needs write access to the repository; another repository is closed.
  const denied = await reader(`/v2/${name}/blobs/uploads/`, { method: 'POST' });
  assert.equal(denied.status, 403);
  assert.equal(await errorOf(denied), 'DENIED');
  const foreign = await call('/v2/private/web/manifests/v1');
  assert.equal(foreign.status, 403);
});

test('a repeated push stores nothing twice and tags page in order', async (t) => {
  const { f, call } = await registry(t);
  const name = 'releases/app';
  const first = await pushImage(call, name, 'b');
  const blobs = await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_uploads');
  // The same layer again: the upload completes against the stored blob.
  await pushBlob(call, name, first.layer, 2);
  for (const tag of ['a', 'c']) {
    const again = await putManifest(call, name, tag, first.manifest);
    assert.equal(again.status, 201);
  }
  const after = await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_uploads');
  assert.equal(after.rows[0].n, blobs.rows[0].n, 'no new artifacts');
  const page = await call(`/v2/${name}/tags/list?n=2`);
  assert.deepEqual((await page.json()).tags, ['a', 'b']);
  assert.equal(page.headers.get('link'), `</v2/${name}/tags/list?n=2&last=b>; rel="next"`);
  const rest = await call(`/v2/${name}/tags/list?n=2&last=b`);
  assert.deepEqual((await rest.json()).tags, ['c']);
  assert.equal(rest.headers.get('link'), null);
});

test('the registry refuses unknown content, wrong digests, gaps and other routes', async (t) => {
  const { f, call } = await registry(t);
  const name = 'releases/app';
  const config = Buffer.from('{}');
  const missing = imageManifest(config, [Buffer.from('never pushed')]);
  await pushBlob(call, name, config);
  const unknown = await putManifest(call, name, 'v1', missing);
  assert.equal(unknown.status, 400);
  assert.equal(await errorOf(unknown), 'MANIFEST_BLOB_UNKNOWN');
  const plain = await putManifest(call, name, 'v1', missing, 'application/json');
  assert.equal(plain.status, 415);
  assert.equal(await errorOf(plain), 'MANIFEST_INVALID');
  const mismatch = await putManifest(
    call,
    name,
    digestOf(Buffer.from('x')),
    imageManifest(config, []),
  );
  assert.equal(await errorOf(mismatch), 'DIGEST_INVALID');

  const started = await call(`/v2/${name}/blobs/uploads/`, { method: 'POST' });
  const location = started.headers.get('location');
  const body = Buffer.from('some bytes');
  const gap = await call(location, {
    method: 'PATCH',
    headers: { 'content-type': 'application/octet-stream', 'content-range': '5-14' },
    body,
  });
  assert.equal(gap.status, 416);
  const wrong = await call(`${location}?digest=${digestOf(Buffer.from('other'))}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  assert.equal(wrong.status, 400);
  assert.equal(await errorOf(wrong), 'DIGEST_INVALID');
  const cancelled = await f.catalog.pool.query(
    `SELECT status FROM arkvory_uploads WHERE descriptor->>'name'=$1`,
    [digestOf(Buffer.from('other'))],
  );
  assert.deepEqual(cancelled.rows, [{ status: 'cancelled' }]);

  for (const [path, status, code] of [
    [`/v2/${name}/blobs/${digestOf(Buffer.from('none'))}`, 404, 'BLOB_UNKNOWN'],
    [`/v2/${name}/manifests/v9`, 404, 'MANIFEST_UNKNOWN'],
    [`/v2/${name}/referrers/${digestOf(config)}`, 404, 'UNSUPPORTED'],
    [
      `/v2/${name}/blobs/uploads/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`,
      404,
      'BLOB_UPLOAD_UNKNOWN',
    ],
    ['/v2/Releases/app/tags/list', 400, 'NAME_INVALID'],
  ]) {
    const response = await call(path);
    assert.equal(response.status, status, path);
    assert.equal(await errorOf(response), code, path);
  }
  const removal = await call(`/v2/${name}/blobs/${digestOf(config)}`, { method: 'DELETE' });
  assert.equal(removal.status, 405);
});

async function cleaner(f, url) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  const bindings = [
    {
      resource: { kind: 'repository', id: 'releases' },
      actions: ['artifact.delete', 'artifact.read', 'artifact.list', 'content.read'],
    },
  ];
  const account = await root.createServiceAccount('cleaner', bindings);
  const key = await root.issueServiceKey(account.id, 'issue-cleaner', {
    name: 'cleaner',
    bindings,
  });
  const client = new ArkvoryClient(url, () => key.secret);
  await client.activateServiceKey();
  return { client, secret: key.secret };
}
const artifactOf = async (f, table, digest) =>
  (
    await f.catalog.pool.query(`SELECT artifact_id::text AS id FROM ${table} WHERE digest=$1`, [
      digest,
    ])
  ).rows[0].id;

test('retention spares an image until its manifest is deleted by digest', async (t) => {
  const { f, url, call, as } = await registry(t);
  const name = 'releases/app';
  const image = await pushImage(call, name, 'v1');
  const { client, secret } = await cleaner(f, url);
  const admin = as(basic(secret));
  const artifacts = client.inRepository('releases').artifacts;
  const layer = await artifactOf(f, 'arkvory_oci_blobs', digestOf(image.layer));
  const manifest = await artifactOf(f, 'arkvory_oci_manifests', image.digest);
  for (const id of [layer, manifest])
    assert.deepEqual((await artifacts.inspectDeletion(id)).blockers, ['reference']);

  const untag = await admin(`/v2/${name}/manifests/v1`, { method: 'DELETE' });
  assert.equal(untag.status, 202);
  assert.deepEqual((await (await call(`/v2/${name}/tags/list`)).json()).tags, []);
  assert.equal((await call(`/v2/${name}/manifests/${image.digest}`)).status, 200);
  assert.deepEqual((await artifacts.inspectDeletion(layer)).blockers, ['reference']);
  const pushOnly = await call(`/v2/${name}/manifests/${image.digest}`, { method: 'DELETE' });
  assert.equal(pushOnly.status, 403, 'deleting needs artifact.delete');
  const removed = await admin(`/v2/${name}/manifests/${image.digest}`, { method: 'DELETE' });
  assert.equal(removed.status, 202);
  assert.equal(
    await errorOf(await call(`/v2/${name}/manifests/${image.digest}`)),
    'MANIFEST_UNKNOWN',
  );
  for (const id of [layer, manifest])
    assert.deepEqual((await artifacts.inspectDeletion(id)).blockers, []);

  // Once retention removed the layer, the registry no longer offers it and accepts it again.
  assert.equal((await artifacts.delete(layer, 0)).outcome, 'deleted');
  const gone = await call(`/v2/${name}/blobs/${digestOf(image.layer)}`, { method: 'HEAD' });
  assert.equal(gone.status, 404);
  await pushBlob(call, name, image.layer);
  assert.equal((await putManifest(call, name, 'v2', image.manifest)).status, 201);
  const pulled = await call(`/v2/${name}/blobs/${digestOf(image.layer)}`);
  assert.deepEqual(Buffer.from(await pulled.arrayBuffer()), image.layer);
});

test('an index needs its platform manifests; abandoned uploads expire with their bytes', async (t) => {
  const { f, call } = await registry(t);
  const name = 'releases/multi';
  const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux' }));
  const layer = randomBytes(1024);
  await pushBlob(call, name, config);
  await pushBlob(call, name, layer);
  const platform = imageManifest(config, [layer]);
  const amd = { digest: digestOf(platform) };
  assert.equal((await putManifest(call, name, amd.digest, platform)).status, 201);
  const index = (digests) =>
    Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: indexType,
        manifests: digests.map((digest) => ({ mediaType: imageType, digest, size: 1 })),
      }),
    );
  const missing = await putManifest(
    call,
    name,
    'latest',
    index([amd.digest, digestOf(Buffer.from('arm'))]),
    indexType,
  );
  assert.equal(await errorOf(missing), 'MANIFEST_BLOB_UNKNOWN');
  const stored = await putManifest(call, name, 'latest', index([amd.digest]), indexType);
  assert.equal(stored.status, 201);
  assert.equal((await call(`/v2/${name}/manifests/latest`)).headers.get('content-type'), indexType);

  const started = await call(`/v2/${name}/blobs/uploads/`, { method: 'POST' });
  const id = started.headers.get('docker-upload-uuid');
  await call(started.headers.get('location'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('half'),
  });
  const staged = join(f.directory, 'oci-uploads', id);
  await f.catalog.pool.query(
    `UPDATE arkvory_oci_uploads SET updated_at=now()-interval '2 days' WHERE id=$1`,
    [id],
  );
  const old = new Date(Date.now() - 2 * 86400e3);
  await utimes(staged, old, old);
  const sweeper = new OciRegistry(
    null,
    new PostgresOciIndex(f.catalog.pool),
    new FileOciStaging(f.directory, async () => undefined),
    { next: () => id },
    1,
  );
  assert.equal(await sweeper.expireUploads(), 1);
  assert.deepEqual(await readdir(join(f.directory, 'oci-uploads')), []);
  const status = await call(started.headers.get('location'));
  assert.equal(await errorOf(status), 'BLOB_UPLOAD_UNKNOWN');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArkvoryError,
  OciError,
  parseOciManifest,
  parseOciPath,
  ociDigest,
} from '@proanima/arkvory-domain';
import { OciRegistry } from '@proanima/arkvory-application';

const digest = (c) => `sha256:${c.repeat(64)}`;
const refused = (code, status) => (error) =>
  error instanceof OciError && error.code === code && error.status === (status ?? error.status);

test('registry paths: the repository, a nested image name and the route at the end', () => {
  assert.deepEqual(parseOciPath('releases/app/manifests/v1.2'), {
    repository: 'releases',
    image: 'app',
    route: { kind: 'manifest', reference: 'v1.2' },
  });
  // Route words are ordinary image components when the route follows them.
  assert.deepEqual(parseOciPath('releases/team/tags/blobs/tags/list'), {
    repository: 'releases',
    image: 'team/tags/blobs',
    route: { kind: 'tags' },
  });
  assert.deepEqual(parseOciPath(`releases/a/b/blobs/${digest('a')}`).route, {
    kind: 'blob',
    digest: digest('a'),
  });
  for (const path of ['releases/app/blobs/uploads', 'releases/app/blobs/uploads/'])
    assert.deepEqual(parseOciPath(path).route, { kind: 'uploads' });
  const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
  assert.deepEqual(parseOciPath(`releases/app/blobs/uploads/${id}`).route, {
    kind: 'upload',
    upload: id,
  });
  assert.equal(parseOciPath(`releases/app/manifests/${digest('b')}`).route.reference, digest('b'));
});

test('registry paths refuse names, references and routes the specification does not allow', () => {
  for (const [path, code, status] of [
    ['releases/manifests/v1', 'NAME_INVALID', 400],
    ['Releases/app/manifests/v1', 'NAME_INVALID', 400],
    ['releases/App/manifests/v1', 'NAME_INVALID', 400],
    ['releases/app/manifests/-bad', 'MANIFEST_INVALID', 400],
    ['releases/app/manifests/sha256:abc', 'DIGEST_INVALID', 400],
    ['releases/app/blobs/md5:abc', 'UNSUPPORTED', 415],
    ['releases/app/blobs/sha256:abc', 'DIGEST_INVALID', 400],
    ['releases/app/blobs/uploads/not-an-id', 'BLOB_UPLOAD_UNKNOWN', 404],
    [`releases/app/blobs/uploads/${'-'.repeat(36)}`, 'BLOB_UPLOAD_UNKNOWN', 404],
    [`releases/app/referrers/${digest('c')}`, 'UNSUPPORTED', 404],
    ['releases/app/catalog', 'NAME_UNKNOWN', 404],
    [`releases/${'a'.repeat(201)}/tags/list`, 'NAME_INVALID', 400],
  ])
    assert.throws(() => parseOciPath(path), refused(code, status), path);
  assert.throws(() => ociDigest('sha512:' + 'a'.repeat(128)), refused('UNSUPPORTED'));
});

const image = (extra = {}) =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: digest('c'), size: 2 },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: digest('d'), size: 3 }],
    ...extra,
  });

test('manifests yield the digests the registry must hold; type and shape are checked', () => {
  const text = image();
  assert.deepEqual(parseOciManifest(text, text.length, undefined), {
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    blobs: [digest('c'), digest('d')],
    manifests: [],
  });
  // Index entries are manifests by their media type (or none given), anything else a blob.
  const index = JSON.stringify({
    schemaVersion: 2,
    manifests: [
      { digest: digest('e'), size: 1, mediaType: 'application/vnd.oci.image.manifest.v1+json' },
      { digest: digest('f'), size: 1 },
      { digest: digest('a'), size: 1, mediaType: 'application/vnd.buildkit.cacheconfig.v0' },
    ],
  });
  assert.deepEqual(
    parseOciManifest(index, index.length, 'application/vnd.oci.image.index.v1+json; charset=x'),
    {
      mediaType: 'application/vnd.oci.image.index.v1+json',
      blobs: [digest('a')],
      manifests: [digest('e'), digest('f')],
    },
  );
  const docker = image({ mediaType: 'application/vnd.docker.distribution.manifest.v2+json' });
  assert.equal(
    parseOciManifest(docker, docker.length, undefined).mediaType,
    'application/vnd.docker.distribution.manifest.v2+json',
  );
  for (const [body, type, size] of [
    [text, 'application/vnd.oci.image.index.v1+json'],
    [text, 'application/json'],
    [image({ schemaVersion: 1 }), undefined],
    [image({ config: undefined }), undefined],
    [image({ layers: [{ digest: 'md5:abc' }] }), undefined],
    [image({ layers: {} }), undefined],
    ['[]', 'application/vnd.oci.image.manifest.v1+json'],
    ['{', 'application/vnd.oci.image.manifest.v1+json'],
    [text, undefined, 0],
    [text, undefined, 4 * 1024 * 1024 + 1],
  ])
    assert.throws(
      () => parseOciManifest(body, size ?? body.length, type),
      refused('MANIFEST_INVALID'),
    );
});

const principal = {
  id: 'user:a',
  credential: 'session',
  repositories: ['releases'],
  permissions: ['read', 'write'],
};
const path = { repository: 'releases', image: 'app', id: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' };
function registry(overrides = {}) {
  const state = { ...path, owner: 'user:a', received: 4 };
  const calls = [];
  const index = {
    upload: async (id) => (id === path.id ? state : null),
    blob: async () => null,
    setReceived: async (id, size) => calls.push(['received', size]),
    stagingRoom: async () => Number.MAX_SAFE_INTEGER,
    endUpload: async (id) => calls.push(['end', id]),
    addBlob: async (...args) => calls.push(['blob', ...args]),
    ...overrides.index,
  };
  const staging = {
    append: async (id, offset, source) => {
      let size = offset;
      for await (const chunk of source) size += chunk.length;
      return size;
    },
    read: async function* () {
      yield new Uint8Array(4);
    },
    remove: async (id) => calls.push(['remove', id]),
    ...overrides.staging,
  };
  const storage = {
    create: async (who, repository, key, descriptor) => {
      calls.push(['create', key, descriptor.size, descriptor.sha256]);
      return { id: 'artifact', status: 'pending' };
    },
    upload: async () => {
      throw new ArkvoryError('integrity_mismatch', 'differs');
    },
    cancel: async (who, repository, id) => calls.push(['cancel', id]),
    ...overrides.storage,
  };
  return { calls, registry: new OciRegistry(storage, index, staging, { next: () => 'x' }, 10) };
}
const bytes = (n) => ({
  async *[Symbol.asyncIterator]() {
    yield new Uint8Array(n);
  },
});
const never = { throwIfAborted() {} };

test('chunks continue at the received size; a foreign or unknown upload is unknown', async () => {
  const { registry: r, calls } = registry();
  assert.equal(await r.append(principal, path, 4, bytes(3), never), 7);
  assert.deepEqual(calls, [['received', 7]]);
  await assert.rejects(
    r.append(principal, path, 0, bytes(1), never),
    refused('BLOB_UPLOAD_INVALID', 416),
  );
  for (const other of [
    { ...principal, id: 'user:b' },
    { ...principal, repositories: ['releases'], id: 'user:a', permissions: ['read'] },
  ])
    await assert.rejects(r.append(other, path, 4, bytes(1), never));
  await assert.rejects(
    r.append(principal, { ...path, image: 'other' }, 4, bytes(1), never),
    refused('BLOB_UPLOAD_UNKNOWN'),
  );
});

test('requests on one upload are serialized; a mismatching digest cancels its artifact', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { registry: r, calls } = registry({
    staging: {
      append: async () => {
        await held;
        return 5;
      },
    },
  });
  const first = r.append(principal, path, 4, bytes(1), never);
  await assert.rejects(
    r.finish(principal, path, digest('a'), never),
    refused('BLOB_UPLOAD_INVALID'),
  );
  release();
  assert.equal(await first, 5);
  await assert.rejects(r.finish(principal, path, digest('a'), never), refused('DIGEST_INVALID'));
  assert.deepEqual(calls.slice(-2), [
    ['create', `oci-${path.id}`, '4', 'a'.repeat(64)],
    ['cancel', 'artifact'],
  ]);
  assert.ok(!calls.some(([name]) => name === 'blob' || name === 'end'), 'the upload stays open');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadLinks, downloadLinkTtl } from '@proanima/arkvory-application';
import { readDownloadLink } from '@proanima/arkvory-contracts';

const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
function links(binding = { repository: 'releases', artifactId: id, issuer: 'user:a' }) {
  const created = [];
  const storage = {
    artifact: async (principal, repository, artifact, permission) => {
      assert.equal(permission, 'content.read');
      return { id: artifact };
    },
  };
  const store = {
    create: async (link) => {
      created.push(link);
      return { token: `dtl_${'a'.repeat(43)}`, expiresAt: '2026-10-03T13:00:00.000Z' };
    },
    resolve: async (token) => (token === 'live' ? binding : null),
    rejection: async () => 'token_expired',
  };
  return { created, service: new DownloadLinks(storage, store) };
}
const user = { credential: 'session', id: 'user:a', repositories: [], permissions: [] };

test('a link is issued by a reader for a bounded time and pays from the issuer budget', async () => {
  const { created, service } = links();
  await service.create(user, 'releases', id);
  assert.deepEqual(created, [
    {
      repository: 'releases',
      artifactId: id,
      issuer: 'user:a',
      ttlSeconds: downloadLinkTtl.default,
    },
  ]);
  for (const ttl of [59, 86401, 1.5, Number.NaN])
    await assert.rejects(service.create(user, 'releases', id, ttl), { code: 'invalid_input' });
  await assert.rejects(
    service.create({ ...user, credential: 'transfer-token' }, 'releases', id),
    { code: 'forbidden' },
    'a link never extends itself',
  );
});

test('a link authenticates read of its own artifact only', async () => {
  const { service } = links();
  const holder = await service.principal('live', 'releases', id);
  assert.deepEqual(holder, {
    credential: 'transfer-token',
    id: 'user:a',
    repositories: ['releases'],
    permissions: ['read'],
    grants: [{ repository: 'releases', permissions: ['read'] }],
  });
  assert.equal(await service.principal('live', 'other', id), null);
  assert.equal(
    await service.principal('live', 'releases', '00000000-0000-4000-8000-000000000000'),
    null,
  );
  assert.equal(await service.principal('dead', 'releases', id), null);
});

test('the SDK reads only well-formed links', () => {
  const ok = {
    token: `dtl_${'b'.repeat(43)}`,
    url: '/api/v1/repositories/r/artifacts/x/content?token=t',
    expiresAt: '2026-10-03T13:00:00.000Z',
  };
  assert.deepEqual(readDownloadLink(ok), ok);
  for (const bad of [
    { ...ok, token: 'pat_x' },
    { ...ok, url: 'https://elsewhere/' },
    { ...ok, expiresAt: 'soon' },
  ])
    assert.throws(() => readDownloadLink(bad));
});

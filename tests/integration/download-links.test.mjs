import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, base } from './fixture.mjs';
import { publish } from './backup-fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const link = (f, id, payload = {}, headers = f.headers) =>
  f.app.inject({ method: 'POST', url: `${base}/artifacts/${id}/links`, headers, payload });

test('a link downloads exactly its artifact without a credential, until it expires', async (t) => {
  const f = await setup(t);
  const first = await publish(f, randomBytes(4096));
  const second = await publish(f, randomBytes(512));
  const created = await link(f, first.id);
  assert.equal(created.statusCode, 201, created.body);
  const body = created.json();
  assert.match(body.token, /^dtl_[A-Za-z0-9_-]{43}$/);
  assert.equal(body.url, `${base}/artifacts/${first.id}/content?token=${body.token}`);
  const lifetime = Date.parse(body.expiresAt) - Date.now();
  assert.ok(lifetime > 3500e3 && lifetime <= 3600e3, `one hour by default: ${String(lifetime)}`);

  const whole = await f.app.inject({ url: body.url });
  assert.equal(whole.statusCode, 200, whole.body);
  assert.equal(sha(whole.rawPayload), sha(first.bytes));
  assert.equal(whole.headers['cache-control'], 'private, no-store');
  const part = await f.app.inject({ url: body.url, headers: { range: 'bytes=0-9' } });
  assert.equal(part.statusCode, 206);
  assert.deepEqual(part.rawPayload, first.bytes.subarray(0, 10));
  const head = await f.app.inject({ method: 'HEAD', url: body.url });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-length'], String(first.bytes.length));

  // The link names one artifact of one repository and works on its content only.
  const other = await f.app.inject({
    url: `${base}/artifacts/${second.id}/content?token=${body.token}`,
  });
  assert.equal(other.statusCode, 401);
  assert.equal(other.json().reason, 'credential_invalid');
  for (const url of [
    `${base}/artifacts/${first.id}?token=${body.token}`,
    `${base}/artifacts?token=${body.token}`,
  ]) {
    const refused = await f.app.inject({ url });
    assert.equal(refused.statusCode, 401, url);
    assert.equal(refused.json().reason, 'credential_missing', url);
  }
  // A link never issues links; an Authorization header always wins over the parameter.
  const chained = await f.app.inject({
    method: 'POST',
    url: `${base}/artifacts/${first.id}/links?token=${body.token}`,
    payload: {},
  });
  assert.equal(chained.statusCode, 401);
  const both = await f.app.inject({
    url: `${base}/artifacts/${second.id}/content?token=${body.token}`,
    headers: f.readerHeaders,
  });
  assert.equal(both.statusCode, 200, 'the reader key authorizes, the stray token is ignored');

  // Expiry is the database's: a link past its time is refused as expired.
  await f.catalog.pool.query(
    `UPDATE arkvory_transfer_links SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 second'`,
  );
  const expired = await f.app.inject({ url: body.url });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().reason, 'token_expired');
  const forged = await f.app.inject({
    url: `${base}/artifacts/${first.id}/content?token=dtl_${'A'.repeat(43)}`,
  });
  assert.equal(forged.json().reason, 'credential_invalid');
});

test('only a reader of the content creates links, for 60 seconds up to a day', async (t) => {
  const f = await setup(t);
  const artifact = await publish(f);
  const reader = await link(f, artifact.id, { ttlSeconds: 86400 }, f.readerHeaders);
  assert.equal(reader.statusCode, 201, reader.body);
  for (const [payload, field] of [
    [{ ttlSeconds: 59 }, '/ttlSeconds'],
    [{ ttlSeconds: 86401 }, '/ttlSeconds'],
    [{ ttlSeconds: '3600' }, '/ttlSeconds'],
    [{ ttl: 60 }, '/ttl'],
  ]) {
    const refused = await link(f, artifact.id, payload);
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
    assert.equal(refused.json().details?.[0]?.field, field, JSON.stringify(payload));
  }
  const missing = await link(f, '00000000-0000-4000-8000-000000000000');
  assert.equal(missing.statusCode, 404);
  const anonymous = await f.app.inject({
    method: 'POST',
    url: `${base}/artifacts/${artifact.id}/links`,
    payload: {},
  });
  assert.equal(anonymous.statusCode, 401);
  const stored = await f.catalog.pool.query(
    'SELECT token_hash, issuer FROM arkvory_transfer_links',
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].issuer, 'test-reader');
  assert.doesNotMatch(stored.rows[0].token_hash, /^dtl_/, 'only the digest is stored');
});

test('the SDK returns an absolute link that downloads over HTTP without a key', async (t) => {
  const f = await setup(t);
  const artifact = await publish(f, randomBytes(2048));
  const origin = await f.listen();
  const client = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  const created = await client.createDownloadLink('releases', artifact.id, { ttlSeconds: 120 });
  assert.ok(created.url.startsWith(`${origin}/api/v1/repositories/releases/artifacts/`));
  const scoped = await client.inRepository('releases').artifacts.link(artifact.id);
  assert.notEqual(scoped.token, created.token, 'every call makes a new link');
  const response = await fetch(created.url);
  assert.equal(response.status, 200);
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(artifact.bytes));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from '../../apps/api/dist/index.js';
import { ZipFile } from 'yazl';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { servicePaths } from '@proanima/arkvory-contracts';
import { LocalBlobStore, PostgresBrowse } from '@proanima/arkvory-infrastructure';
import { setup, base, descriptor } from './fixture.mjs';

const binding = (actions, id = 'releases') => [{ resource: { kind: 'repository', id }, actions }];
const publisher = [
  'upload.create',
  'upload.read',
  'upload.write',
  'upload.complete',
  'upload.cancel',
  'job.read',
  'artifact.read',
  'package.publish',
  'asset.write',
  'annotation.write',
  'reference.write',
];
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function fixture(t, overrides = {}) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  f.config.keys[0].principal.serviceAdministrator = true;
  const address = await f.listen();
  const root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  return Object.assign(f, { root, address, cleanup });
}
async function service(f, actions, name = 'service-' + randomUUID()) {
  const grants = binding(actions);
  const account = await f.root.createServiceAccount(name, grants);
  const issue = await f.root.issueServiceKey(account.id, randomUUID(), {
    name: 'primary',
    bindings: grants,
  });
  const client = new ArkvoryClient(f.address, () => issue.secret);
  await client.activateServiceKey();
  return { account, issue, client, headers: { authorization: `Bearer ${issue.secret}` } };
}
async function part(f, s, upload, bytes) {
  const r = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${upload}/parts/0`,
    headers: {
      ...s.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': hash(bytes),
    },
    payload: bytes,
  });
  assert.equal(r.statusCode, 204, r.body);
}
async function create(f, s, bytes) {
  const r = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...s.headers, 'idempotency-key': randomUUID() },
    payload: descriptor(bytes),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id;
}
test('managed issuance activates once, replays without secret, and does not widen old administration', async (t) => {
  const f = await fixture(t);
  const spec = (await f.app.inject({ url: '/api/v1/openapi.json', headers: f.headers })).json();
  const operationIds = new Set();
  for (const [path, definition] of Object.entries(servicePaths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (!definition[method]) continue;
      const operation = spec.paths[path][method];
      assert.equal(typeof operation.operationId, 'string');
      assert.equal(operationIds.has(operation.operationId), false);
      operationIds.add(operation.operationId);
      assert.equal(
        f.app.hasRoute({ method: method.toUpperCase(), url: path.replace(/\{(\w+)\}/g, ':$1') }),
        true,
        `${method} ${path} must exist in runtime`,
      );
    }
  }
  assert.equal(operationIds.size, 15);
  const grants = binding(['content.read']);
  const account = await f.root.createServiceAccount('release-reader', grants);
  const first = await f.root.issueServiceKey(account.id, 'issue-first', {
    name: 'primary',
    bindings: grants,
  });
  assert.match(first.secret, /^arkvory_/);
  const client = new ArkvoryClient(f.address, () => first.secret);
  await assert.rejects(client.me(), { status: 401 });
  const replay = await f.root.issueServiceKey(account.id, 'issue-first', {
    name: 'primary',
    bindings: grants,
  });
  assert.equal(replay.secret, undefined);
  assert.equal(replay.key.id, first.key.id);
  await assert.rejects(
    f.root.issueServiceKey(account.id, 'issue-first', { name: 'different', bindings: grants }),
    { status: 409 },
  );
  await assert.rejects(
    f.root.issueServiceKey(account.id, 'wide', {
      name: 'wide',
      bindings: binding(['artifact.read']),
    }),
    { status: 403 },
  );
  await client.activateServiceKey();
  await client.activateServiceKey();
  assert.equal((await client.me()).id, `service:${account.id}`);
  assert.deepEqual((await client.permissions()).bindings, grants);
  assert.equal((await client.capabilities()).features.managedServiceKeys, true);
  assert.deepEqual(await client.serviceAccounts(), { items: [], next: null });
  const publicData = JSON.stringify(await f.root.serviceKeys(account.id));
  assert(!publicData.includes(first.secret));
  assert(!publicData.includes('secret_hash'));
  f.config.keys[0].principal.serviceAdministrator = false;
  const denied = await f.app.inject({
    method: 'POST',
    url: '/api/v1/service-accounts',
    headers: f.headers,
    payload: { name: 'forbidden', bindings: [] },
  });
  assert.equal(denied.statusCode, 403);
  f.config.keys[0].principal.serviceAdministrator = true;
  const events = await f.root.serviceAudit(account.id);
  assert.deepEqual(
    events.map((e) => e.action),
    ['service.create', 'key.issue', 'key.activate'],
  );
});
test('publisher cannot read bytes; content key cannot enumerate; legacy downloads share exact permissions', async (t) => {
  const f = await fixture(t),
    publish = await service(f, publisher),
    read = await service(f, ['content.read']);
  const z = new ZipFile();
  z.addBuffer(Buffer.from(JSON.stringify({ name: 'Example', version: '1.0.0' })), 'upack.json');
  z.addBuffer(Buffer.from('body'), 'package/body');
  z.end();
  const chunks = [];
  for await (const chunk of z.outputStream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const upload = await create(f, publish, bytes);
  await part(f, publish, upload, bytes);
  const complete = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${upload}/complete`,
    headers: publish.headers,
  });
  assert.equal(complete.statusCode, 200, complete.body);
  const registered = await f.app.inject({
    method: 'POST',
    url: `${base}/artifacts/${upload}/package`,
    headers: publish.headers,
  });
  assert.equal(registered.statusCode, 200, registered.body);
  await publish.client.setAsset('releases', 'folder/file.upack', upload, 0);
  for (const path of [
    `${base}/artifacts/${upload}/content`,
    '/upack/releases/download/Example/1.0.0',
    '/api/packages/releases/download?name=Example&version=1.0.0',
    '/endpoints/releases/content/folder/file.upack',
  ]) {
    assert.equal((await f.app.inject({ url: path, headers: publish.headers })).statusCode, 403);
    const got = await f.app.inject({ url: path, headers: read.headers });
    assert.equal(got.statusCode, 200, got.body);
    assert.deepEqual(got.rawPayload, bytes);
  }
  for (const path of [
    `${base}/artifacts`,
    `${base}/artifacts/${upload}`,
    `${base}/packages`,
    `${base}/assets`,
    `${base}/search`,
    `${base}/audit`,
  ])
    assert.equal((await f.app.inject({ url: path, headers: read.headers })).statusCode, 403);
  assert.equal(
    (
      await f.app.inject({
        method: 'HEAD',
        url: `${base}/artifacts/${upload}/content`,
        headers: publish.headers,
      })
    ).statusCode,
    403,
  );
  const range = await f.app.inject({
    url: `${base}/artifacts/${upload}/content`,
    headers: { ...read.headers, range: 'bytes=0-9' },
  });
  assert.equal(range.statusCode, 206);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/repositories/private/uploads',
        headers: { ...publish.headers, 'idempotency-key': randomUUID() },
        payload: descriptor(bytes),
      })
    ).statusCode,
    403,
  );
  const pending = await create(f, publish, bytes);
  const other = await service(f, publisher);
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${pending}`, headers: other.headers })).statusCode,
    404,
  );
});
test('rotation preserves upload ownership, narrows rights and enforces revocation and expiry', async (t) => {
  const f = await fixture(t),
    old = await service(f, publisher),
    bytes = Buffer.from('resume after rotation');
  const upload = await create(f, old, bytes);
  await part(f, old, upload, bytes);
  const rotated = await f.root.rotateServiceKey(old.issue.key.id, 'rotate-1', {
    name: 'replacement',
    bindings: binding(['upload.read', 'upload.complete']),
  });
  const client = new ArkvoryClient(f.address, () => rotated.secret);
  await client.activateServiceKey();
  assert.equal((await client.me()).id, (await old.client.me()).id);
  assert(
    Date.parse((await f.root.serviceKey(old.issue.key.id)).expiresAt) <= Date.now() + 86401000,
  );
  await f.root.revokeServiceKey(old.issue.key.id);
  await f.root.revokeServiceKey(old.issue.key.id);
  await assert.rejects(old.client.me(), { status: 401 });
  const complete = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${upload}/complete`,
    headers: { authorization: `Bearer ${rotated.secret}` },
  });
  assert.equal(complete.statusCode, 200, complete.body);
  await assert.rejects(client.create('releases', randomUUID(), descriptor(bytes)), { status: 403 });
  await f.restart();
  await f.listen();
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: old.headers })).statusCode,
    401,
  );
  await f.catalog.pool.query(
    "UPDATE arkvory_api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",
    [rotated.key.id],
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${rotated.secret}` },
      })
    ).statusCode,
    401,
  );
});
test('account CAS and disable take effect immediately; pending expiry and key capacity are enforced concurrently', async (t) => {
  const f = await fixture(t),
    s = await service(f, ['content.read']);
  await f.root.setServicePolicy(s.account.id, 1, []);
  assert.deepEqual((await s.client.permissions()).bindings, []);
  await assert.rejects(f.root.setServicePolicy(s.account.id, 1, binding(['content.read'])), {
    status: 409,
  });
  await f.root.updateServiceAccount(s.account.id, 2, false);
  await assert.rejects(s.client.me(), { status: 401 });
  const a = await f.root.createServiceAccount('bounded', []);
  const issues = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      f.root.issueServiceKey(a.id, 'pending-' + i, { name: 'pending-' + i, bindings: [] }),
    ),
  );
  const issued = issues.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  assert.equal(issued.length, 2);
  assert(issues.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 507));
  await f.catalog.pool.query(
    "UPDATE arkvory_api_keys SET activation_expires_at=now()-interval '1 second' WHERE id=$1",
    [issued[0].key.id],
  );
  await assert.rejects(new ArkvoryClient(f.address, () => issued[0].secret).activateServiceKey(), {
    status: 401,
  });
  const active = [];
  for (let i = 0; i < 3; i++) {
    const k = await f.root.issueServiceKey(a.id, 'active-' + i, {
      name: 'active-' + i,
      bindings: [],
    });
    await new ArkvoryClient(f.address, () => k.secret).activateServiceKey();
    active.push(k);
  }
  const pendingClient = new ArkvoryClient(f.address, () => issued[1].secret);
  await assert.rejects(pendingClient.activateServiceKey(), { status: 507 });
  await f.root.revokeServiceKey(active[0].key.id);
  await pendingClient.activateServiceKey();
});
test('revocation before durable publication and policy change before annotations block stale request authority', async (t) => {
  const f = await fixture(t),
    s = await service(f, publisher),
    bytes = Buffer.from('revoked while streaming');
  const upload = await create(f, s, bytes);
  const put = LocalBlobStore.prototype.put;
  LocalBlobStore.prototype.put = async function (...args) {
    await put.apply(this, args);
    await f.root.revokeServiceKey(s.issue.key.id);
  };
  try {
    const r = await f.app.inject({
      method: 'PUT',
      url: `${base}/uploads/${upload}/content`,
      headers: { ...s.headers, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal((await f.catalog.get('releases', upload)).status, 'pending');
  } finally {
    LocalBlobStore.prototype.put = put;
  }
  const next = await f.root.issueServiceKey(s.account.id, 'resume', {
    name: 'resume',
    bindings: binding(publisher),
  });
  const client = new ArkvoryClient(f.address, () => next.secret);
  await client.activateServiceKey();
  const finished = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${upload}/complete`,
    headers: { authorization: `Bearer ${next.secret}` },
  });
  assert.equal(finished.statusCode, 200, finished.body);
  const annotate = PostgresBrowse.prototype.annotate;
  PostgresBrowse.prototype.annotate = async function (...args) {
    await f.root.setServicePolicy(s.account.id, 1, binding(['artifact.read']));
    return annotate.apply(this, args);
  };
  try {
    await assert.rejects(
      client.annotate('releases', upload, 0, { labels: [], metadata: {}, collections: [] }),
      { status: 403 },
    );
  } finally {
    PostgresBrowse.prototype.annotate = annotate;
  }
  assert.equal(
    (
      await f.catalog.pool.query(
        'SELECT count(*)::int AS n FROM arkvory_annotations WHERE artifact_id=$1',
        [upload],
      )
    ).rows[0].n,
    0,
  );
});
async function worker(f) {
  const file = join(f.directory, 'worker-keys.json');
  await writeFile(
    file,
    JSON.stringify(f.config.keys.map((k) => ({ ...k.principal, sha256: k.sha256 }))),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['apps/worker/dist/main.js', '--once'], {
      windowsHide: true,
      env: {
        ...process.env,
        ARKVORY_DATABASE_URL: f.config.databaseUrl,
        ARKVORY_DATA_DIR: f.directory,
        ARKVORY_KEYS_FILE: file,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(Error(output));
      else resolve();
    });
  });
}
test('worker refuses initiating revoked key and explicit reauthorization retains the same job', async (t) => {
  const f = await fixture(t),
    s = await service(f, publisher),
    bytes = Buffer.from('durable job');
  const upload = await create(f, s, bytes);
  await part(f, s, upload, bytes);
  const request = () =>
    f.app.inject({
      method: 'POST',
      url: `${base}/uploads/${upload}/complete-async`,
      headers: s.headers,
    });
  const queued = await request();
  assert.equal(queued.statusCode, 202, queued.body);
  const fresh = await f.root.rotateServiceKey(s.issue.key.id, 'new-worker-key', {
    name: 'new-worker',
    bindings: binding(publisher),
  });
  await new ArkvoryClient(f.address, () => fresh.secret).activateServiceKey();
  await f.root.revokeServiceKey(s.issue.key.id);
  await worker(f);
  const row = (
    await f.catalog.pool.query('SELECT * FROM arkvory_jobs WHERE id=$1', [queued.json().id])
  ).rows[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.error_code, 'forbidden');
  assert.equal((await f.catalog.get('releases', upload)).status, 'pending');
  s.headers = { authorization: `Bearer ${fresh.secret}` };
  const again = await request();
  assert.equal(again.statusCode, 202, again.body);
  assert.equal(again.json().id, queued.json().id);
  await worker(f);
  assert.equal((await f.catalog.get('releases', upload)).status, 'available');
});

test('independent reader resolves managed keys and applies policy changes and revoke without restart', async (t) => {
  const policy = { slots: 2, slot: 0, bytesPerSecond: 131072, perPrincipalBytesPerSecond: 131072 };
  const f = await fixture(t, { sharedDownloads: policy }),
    p = await service(f, publisher),
    r = await service(f, ['content.read']);
  const bytes = Buffer.from('shared repository');
  const upload = await create(f, p, bytes);
  await part(f, p, upload, bytes);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/uploads/${upload}/complete`,
        headers: p.headers,
      })
    ).statusCode,
    200,
  );
  const reader = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot: 1 },
  });
  f.cleanup.push(() => reader.close());
  const path = `${base}/artifacts/${upload}/content`;
  assert.equal((await reader.inject({ url: path, headers: r.headers })).statusCode, 200);
  await f.root.setServicePolicy(r.account.id, 1, []);
  assert.equal((await reader.inject({ url: path, headers: r.headers })).statusCode, 403);
  await f.root.setServicePolicy(r.account.id, 2, binding(['content.read']));
  assert.equal((await reader.inject({ url: path, headers: r.headers })).statusCode, 200);
  await f.root.revokeServiceKey(r.issue.key.id);
  assert.equal((await reader.inject({ url: path, headers: r.headers })).statusCode, 401);
  assert.equal(
    (await reader.inject({ method: 'POST', url: '/api/v1/auth/activate-key', headers: p.headers }))
      .statusCode,
    405,
  );
});

test('managed key metadata is paginated and dpk credentials never fall back to file authorization', async (t) => {
  const f = await fixture(t),
    s = await service(f, ['content.read']);
  await f.catalog.pool.query(`INSERT INTO arkvory_service_accounts(id,name,bindings)
    SELECT gen_random_uuid(),'page-'||i,'[]'::jsonb FROM generate_series(1,70) i`);
  const one = await f.root.serviceAccounts();
  assert.equal(one.items.length, 50);
  assert(one.next);
  const two = await f.root.serviceAccounts(one.next);
  assert.equal(two.items.length, 21);
  assert.equal(two.next, null);
  assert.equal(new Set([...one.items, ...two.items].map((a) => a.id)).size, 71);
  f.config.keys.push({
    sha256: hash(s.issue.secret),
    principal: { id: 'fallback', repositories: ['releases'], permissions: ['read'] },
  });
  await f.root.revokeServiceKey(s.issue.key.id);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/auth/me', headers: s.headers })).statusCode,
    401,
  );
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=9');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
});

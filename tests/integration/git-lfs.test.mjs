import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { removeTestDirectory } from '../helpers.mjs';
import { setup } from './fixture.mjs';

const run = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The real git and git-lfs with a configuration of their own: no system or global config (no
 * credential manager may prompt), the Arkvory key only in the test repositories' lfs.url.
 */
async function gitIn(work) {
  const home = join(work, 'home');
  await mkdir(home);
  await writeFile(join(home, '.gitconfig'), '[user]\n\tname = CI\n\temail = ci@example.invalid\n');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  };
  const git = async (cwd, args) =>
    (
      await run('git', args, { cwd, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
    ).stdout.trim();
  // The LFS filters in this isolated global config, so that clones smudge too.
  await git(work, ['lfs', 'install', '--skip-repo']);
  return git;
}

test('git pushes and clones large files through Arkvory; locks show their owner', async (t) => {
  const f = await setup(t);
  const origin = new URL(await f.listen());
  const work = await mkdtemp(join(tmpdir(), 'arkvory-lfs-'));
  t.after(() => removeTestDirectory(work));
  const git = await gitIn(work);
  const token = f.headers.authorization.slice(7);
  const lfsUrl = `http://ci:${token}@${origin.host}/lfs/releases`;
  const remote = join(work, 'remote.git').replaceAll('\\', '/');
  const source = join(work, 'source');
  await git(work, ['init', '--bare', '--initial-branch=main', remote]);
  await git(work, ['init', '--initial-branch=main', source]);
  await git(source, ['lfs', 'install', '--local']);
  await git(source, ['config', 'lfs.url', lfsUrl]);
  await git(source, ['config', `lfs.${lfsUrl}.locksverify`, 'true']);
  await git(source, ['lfs', 'track', '*.bin', '*.uasset', '*.prefab']);
  const level = randomBytes(5 * 1024 * 1024 + 3);
  const texture = randomBytes(700 * 1024);
  // Unity text assets: git-lfs sends them as text/plain, below and above the JSON body limit.
  const prefab = (count) =>
    Buffer.from(`%YAML 1.1\n${'--- !u!1 &1\nGameObject:\n  m_Name: Hero\n'.repeat(count)}`);
  const small = prefab(10);
  const large = prefab(5000);
  await writeFile(join(source, 'Level.bin'), level);
  await writeFile(join(source, 'Hero.uasset'), texture);
  await writeFile(join(source, 'Small.prefab'), small);
  await writeFile(join(source, 'Large.prefab'), large);
  await writeFile(join(source, 'README.md'), '# game\n');
  await git(source, ['add', '.']);
  await git(source, ['commit', '-m', 'assets']);
  await git(source, ['remote', 'add', 'origin', remote]);
  await git(source, ['push', 'origin', 'main']);

  // The objects are artifacts of the repository, named by their oid and verified by it.
  const rows = await f.catalog.pool.query(
    `SELECT l.oid, u.size::text AS size FROM arkvory_lfs_objects l
     JOIN arkvory_uploads u ON u.id=l.artifact_id WHERE l.repository='releases' ORDER BY u.size`,
  );
  assert.deepEqual(
    rows.rows.map((row) => [row.oid, row.size]),
    [small, large, texture, level].map((bytes) => [sha(bytes), String(bytes.length)]),
  );

  // A fresh clone gets the bytes from Arkvory through the smudge filter.
  const copy = join(work, 'copy');
  await git(work, ['-c', `lfs.url=${lfsUrl}`, 'clone', remote, copy]);
  assert.equal(sha(await readFile(join(copy, 'Level.bin'))), sha(level));
  assert.equal(sha(await readFile(join(copy, 'Hero.uasset'))), sha(texture));
  assert.equal(sha(await readFile(join(copy, 'Small.prefab'))), sha(small));
  assert.equal(sha(await readFile(join(copy, 'Large.prefab'))), sha(large));

  // Pushing the same objects again sends nothing new.
  await git(source, ['commit', '--allow-empty', '-m', 'again']);
  await git(source, ['push', 'origin', 'main']);
  const count = await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_uploads');
  assert.equal(count.rows[0].n, 4);

  // File locking for binary assets: the lock names its owner, another one cannot take it.
  // git-lfs 3 prints the new locks as a list.
  const [locked] = JSON.parse(await git(source, ['lfs', 'lock', 'Level.bin', '--json']));
  assert.equal(locked.path, 'Level.bin');
  assert.equal(locked.owner.name, 'test-writer');
  const listed = JSON.parse(await git(source, ['lfs', 'locks', '--json']));
  assert.deepEqual(
    listed.map((lock) => [lock.path, lock.owner.name]),
    [['Level.bin', 'test-writer']],
  );
  await assert.rejects(git(source, ['lfs', 'lock', 'Level.bin']), /already created lock|locked/i);
  await git(source, ['lfs', 'unlock', 'Level.bin']);
  assert.deepEqual(JSON.parse(await git(source, ['lfs', 'locks', '--json'])), []);
});

test('the LFS API refuses wrong credentials, sizes and missing objects in its own format', async (t) => {
  const f = await setup(t);
  const origin = await f.listen();
  const batch = (body, headers = f.headers) =>
    fetch(`${origin}/lfs/releases/objects/batch`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/vnd.git-lfs+json' },
      body: JSON.stringify(body),
    });
  const anonymous = await batch({ operation: 'download', objects: [] }, {});
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('lfs-authenticate'), /^Basic realm="Arkvory"/);
  assert.ok((await anonymous.json()).request_id);

  const unknown = await batch({ operation: 'download', objects: [{ oid: sha('none'), size: 4 }] });
  assert.equal(unknown.status, 200);
  assert.deepEqual((await unknown.json()).objects[0].error, {
    code: 404,
    message: 'Object does not exist',
  });
  const invalid = await batch({ operation: 'upload', objects: [{ oid: 'x', size: 1 }] });
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).message, /oid/);
  const sha1 = await batch({
    operation: 'upload',
    hash_algo: 'sha1',
    objects: [{ oid: sha('a'), size: 1 }],
  });
  assert.equal(sha1.status, 409);

  // An upload whose bytes do not hash to its oid stores nothing.
  const bytes = randomBytes(1024);
  const wrong = await fetch(`${origin}/lfs/releases/objects/${sha('other')}`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  assert.equal(wrong.status, 422);
  const reader = await batch(
    { operation: 'upload', objects: [{ oid: sha(bytes), size: bytes.length }] },
    f.readerHeaders,
  );
  assert.equal(reader.status, 403);
});

test('lock pages follow byte order and malformed lock IDs are simply unknown', async (t) => {
  const f = await setup(t);
  const lfs = (method, path, body) =>
    f.app.inject({
      method,
      url: `/lfs/releases/${path}`,
      headers: { ...f.headers, 'content-type': 'application/vnd.git-lfs+json' },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  for (const path of ['Assets/apple.unity', 'Assets/Zebra.unity', 'Assets/Beta.unity'])
    assert.equal((await lfs('POST', 'locks', { path })).statusCode, 201);
  // The database collation may differ from byte order (en_US puts `apple` before `Zebra`).
  const seen = [];
  let cursor = '';
  do {
    const page = (await lfs('GET', `locks?limit=1${cursor ? `&cursor=${cursor}` : ''}`)).json();
    seen.push(...page.locks.map((lock) => lock.path));
    cursor = page.next_cursor ? encodeURIComponent(page.next_cursor) : '';
  } while (cursor);
  assert.deepEqual(seen, ['Assets/Beta.unity', 'Assets/Zebra.unity', 'Assets/apple.unity']);
  const odd = '-'.repeat(36);
  assert.deepEqual((await lfs('GET', `locks?id=${odd}`)).json().locks, []);
  assert.equal((await lfs('POST', `locks/${odd}/unlock`, {})).statusCode, 404);
});

test('an expired or cancelled attempt never blocks its object; write-only keys see stored ones', async (t) => {
  const writer = `w-${sha(randomBytes(16))}`;
  const pusher = `p-${sha(randomBytes(16))}`;
  const key = (token, id, permissions) => ({
    sha256: sha(token),
    principal: { id, repositories: ['releases'], permissions },
  });
  const f = await setup(t, {
    keys: [key(writer, 'test-writer', ['read', 'write']), key(pusher, 'ci-push', ['write'])],
  });
  const as = (token) => ({ authorization: `Bearer ${token}` });
  const put = (token, bytes) =>
    f.app.inject({
      method: 'PUT',
      url: `/lfs/releases/objects/${sha(bytes)}`,
      headers: { ...as(token), 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
  // An earlier attempt of the same owner under the oid's key: one expired, one cancelled.
  const attempt = async (bytes) => {
    const oid = sha(bytes);
    const started = await f.app.inject({
      method: 'POST',
      url: '/api/v1/repositories/releases/uploads',
      headers: { ...as(writer), 'idempotency-key': `lfs-${oid}` },
      payload: {
        name: oid,
        size: String(bytes.length),
        sha256: oid,
        labels: ['lfs'],
        metadata: {},
      },
    });
    assert.equal(started.statusCode, 201, started.body);
    return started.json().id;
  };
  const expired = randomBytes(4096);
  const id = await attempt(expired);
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  const cancelled = randomBytes(2048);
  const other = await attempt(cancelled);
  const cancel = await f.app.inject({
    method: 'DELETE',
    url: `/api/v1/repositories/releases/uploads/${other}`,
    headers: as(writer),
  });
  assert.equal(cancel.statusCode, 200, cancel.body);
  for (const bytes of [expired, cancelled]) {
    assert.equal((await put(writer, bytes)).statusCode, 200);
    const got = await f.app.inject({
      url: `/lfs/releases/objects/${sha(bytes)}`,
      headers: as(writer),
    });
    assert.deepEqual(got.rawPayload, bytes);
  }

  // A key that may only push (no content.read) still learns that an object is stored.
  const batch = await f.app.inject({
    method: 'POST',
    url: '/lfs/releases/objects/batch',
    headers: { ...as(pusher), 'content-type': 'application/vnd.git-lfs+json' },
    payload: JSON.stringify({
      operation: 'upload',
      objects: [{ oid: sha(expired), size: expired.length }],
    }),
  });
  assert.equal(batch.statusCode, 200, batch.body);
  assert.equal(batch.json().objects[0].actions, undefined, 'stored: nothing to send');
  assert.equal((await put(pusher, expired)).statusCode, 200);
});

test('transfer actions carry the key only to an https origin or loopback', async (t) => {
  const f = await setup(t);
  const bytes = randomBytes(64);
  const put = await f.app.inject({
    method: 'PUT',
    url: `/lfs/releases/objects/${sha(bytes)}`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200);
  const download = async (headers) =>
    (
      await f.app.inject({
        method: 'POST',
        url: '/lfs/releases/objects/batch',
        headers: { ...f.headers, 'content-type': 'application/vnd.git-lfs+json', ...headers },
        payload: JSON.stringify({
          operation: 'download',
          objects: [{ oid: sha(bytes), size: bytes.length }],
        }),
      })
    ).json().objects[0].actions.download;
  // TLS ended at a proxy not listed as trusted: the scheme may only be upgraded.
  const proxied = await download({ host: 'arkvory.example', 'x-forwarded-proto': 'https' });
  assert.match(proxied.href, /^https:\/\/arkvory\.example\/lfs\/releases\/objects\//);
  assert.equal(proxied.header.Authorization, f.headers.authorization);
  const plain = await download({ host: 'arkvory.example' });
  assert.match(plain.href, /^http:\/\/arkvory\.example\//);
  assert.equal(plain.header, undefined, 'no key into a clear-text link');
  const local = await download({ host: '127.0.0.1:8080', 'x-forwarded-proto': 'http' });
  assert.equal(local.header.Authorization, f.headers.authorization);
});

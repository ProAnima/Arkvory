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
  await git(source, ['lfs', 'track', '*.bin', '*.uasset']);
  const level = randomBytes(5 * 1024 * 1024 + 3);
  const texture = randomBytes(700 * 1024);
  await writeFile(join(source, 'Level.bin'), level);
  await writeFile(join(source, 'Hero.uasset'), texture);
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
    [
      [sha(texture), String(texture.length)],
      [sha(level), String(level.length)],
    ],
  );

  // A fresh clone gets the bytes from Arkvory through the smudge filter.
  const copy = join(work, 'copy');
  await git(work, ['-c', `lfs.url=${lfsUrl}`, 'clone', remote, copy]);
  assert.equal(sha(await readFile(join(copy, 'Level.bin'))), sha(level));
  assert.equal(sha(await readFile(join(copy, 'Hero.uasset'))), sha(texture));

  // Pushing the same objects again sends nothing new.
  await git(source, ['commit', '--allow-empty', '-m', 'again']);
  await git(source, ['push', 'origin', 'main']);
  const count = await f.catalog.pool.query('SELECT count(*)::int AS n FROM arkvory_uploads');
  assert.equal(count.rows[0].n, 2);

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

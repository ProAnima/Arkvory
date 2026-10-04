import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, base } from './fixture.mjs';

const run = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The real curl, as a CI script would call it; returns the HTTP status and the JSON body. */
async function curl(args) {
  const { stdout } = await run('curl', ['-sS', '-w', '\n%{http_code}', ...args], {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const lines = stdout.trimEnd().split('\n');
  const status = Number(lines.pop());
  const text = lines.join('\n');
  return { status, body: text.startsWith('{') ? JSON.parse(text) : text };
}

test('curl stores files by path; the same bytes again add no revision', async (t) => {
  const f = await setup(t);
  const origin = await f.listen();
  const work = await mkdtemp(join(tmpdir(), 'arkvory-raw-'));
  t.after(() => removeTestDirectory(work));
  const auth = ['-H', `Authorization: ${f.headers.authorization}`];
  const url = `${origin}${base}/raw/builds/game/1.0/Game Setup.exe`.replaceAll(' ', '%20');
  const first = randomBytes(3 * 1024 * 1024 + 17);
  const file = join(work, 'first.bin');
  await writeFile(file, first);

  // Without a checksum: staged and hashed by the server.
  const created = await curl([...auth, '-T', file, url]);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.path, 'builds/game/1.0/Game Setup.exe');
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.created, true);
  assert.equal(created.body.artifact.sha256, sha(first));
  assert.equal(created.body.artifact.size, String(first.length));

  // The same bytes with a checksum: nothing stored, the revision stays (a retried CI step).
  const checksum = ['-H', `X-Checksum-Sha256: ${sha(first)}`];
  const again = await curl([...auth, ...checksum, '-T', file, url]);
  assert.equal(again.status, 200);
  assert.deepEqual(
    { revision: again.body.revision, created: again.body.created, id: again.body.artifact.id },
    { revision: 1, created: false, id: created.body.artifact.id },
  );

  // New bytes with their checksum stream straight to storage as revision 2.
  const second = randomBytes(1024 * 1024);
  await writeFile(file, second);
  const next = await curl([...auth, '-H', `X-Checksum-Sha256: ${sha(second)}`, '-T', file, url]);
  assert.equal(next.status, 201);
  assert.equal(next.body.revision, 2);

  // A wrong checksum stores nothing; the path keeps revision 2.
  const wrong = await curl([...auth, '-H', `X-Checksum-Sha256: ${sha(first)}`, '-T', file, url]);
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.code, 'integrity_mismatch');
  // ...and holds no quota: the failed attempt is cancelled, not left pending for a week.
  const pending = await f.catalog.pool.query(
    "SELECT count(*)::int AS n FROM arkvory_uploads WHERE status='pending'",
  );
  assert.equal(pending.rows[0].n, 0);

  // Downloads: whole file, Range, HEAD; the current revision is served.
  const output = join(work, 'out.bin');
  const got = await curl([...auth, '-o', output, url]);
  assert.equal(got.status, 200);
  assert.equal(sha(await readFile(output)), sha(second));
  const range = await fetch(url, { headers: { ...f.headers, range: 'bytes=10-19' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), second.subarray(10, 20));
  const head = await fetch(url, { method: 'HEAD', headers: f.headers });
  assert.equal(head.headers.get('content-length'), String(second.length));
  assert.equal(head.headers.get('x-arkvory-artifact-id'), next.body.artifact.id);

  // If-None-Match: * only creates; the path history API sees both revisions.
  const exists = await curl([...auth, '-H', 'If-None-Match: *', '-T', file, url]);
  assert.equal(exists.status, 409);
  assert.equal(exists.body.reason, 'already_exists');
  const history = await fetch(
    `${origin}${base}/asset/history?path=${encodeURIComponent('builds/game/1.0/Game Setup.exe')}`,
    { headers: f.headers },
  );
  assert.deepEqual(
    (await history.json()).items.map((item) => item.revision),
    [2, 1],
  );
});

test('any media type is stored as bytes; access and paths are checked', async (t) => {
  const f = await setup(t);
  const origin = await f.listen();
  const url = (path) => `${origin}${base}/raw/${path}`;
  const json = Buffer.from('{"name":"settings","version":3}');
  const stored = await fetch(url('config/settings.json'), {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/json' },
    body: json,
  });
  assert.equal(stored.status, 201, await stored.clone().text());
  const read = await fetch(url('config/settings.json'), { headers: f.readerHeaders });
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), json);

  // A chunked body without Content-Length is staged like a body without a checksum.
  const chunked = await fetch(url('logs/build.log'), {
    method: 'PUT',
    headers: f.headers,
    body: new Blob([randomBytes(70_000)]).stream(),
    duplex: 'half',
  });
  assert.equal(chunked.status, 201);

  const denied = await fetch(url('config/other.json'), {
    method: 'PUT',
    headers: f.readerHeaders,
    body: json,
  });
  assert.equal(denied.status, 403);
  const anonymous = await fetch(url('config/settings.json'));
  assert.equal(anonymous.status, 401);
  // Dot segments never arrive: URL parsers (curl, fetch) resolve them before sending.
  for (const bad of ['a//b.bin', 'C%3A/b.bin', 'a%5Cb.bin']) {
    const refused = await fetch(url(bad), { method: 'PUT', headers: f.headers, body: json });
    assert.equal(refused.status, 400, bad);
  }
  const missing = await fetch(url('never/stored.bin'), { headers: f.headers });
  assert.equal(missing.status, 404);
});

test('the SDK stores in one request; arkvoryctl put and get go through resumable transfers', async (t) => {
  const f = await setup(t);
  const origin = await f.listen();
  const work = await mkdtemp(join(tmpdir(), 'arkvory-raw-cli-'));
  t.after(() => removeTestDirectory(work));
  const token = f.headers.authorization.slice(7);
  const client = new ArkvoryClient(origin, () => token);
  const bytes = randomBytes(256 * 1024);
  const stored = await client
    .inRepository('releases')
    .assets.put('sdk/tool.zip', new Blob([bytes]), {
      sha256: sha(bytes),
    });
  assert.equal(stored.created, true);
  const unchanged = await client.raw.putRawFile('releases', 'sdk/tool.zip', new Blob([bytes]));
  assert.equal(unchanged.created, false);
  const part = await client.raw.downloadRawFile('releases', 'sdk/tool.zip', {
    start: 0,
    end: 9,
  });
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 10));
  // `..` would be resolved into another repository's route before any request: refused locally.
  for (const path of ['../../other/raw/x.zip', 'a//b', 'a/./b', 'C:/x'])
    await assert.rejects(client.raw.putRawFile('releases', path, new Blob([bytes])), {
      code: 'invalid_argument',
    });

  const env = {
    ...process.env,
    ARKVORY_CLI_HOME: join(work, 'cli'),
    ARKVORY_BASE_URL: origin + '/',
    ARKVORY_TOKEN: token,
  };
  delete env.ARKVORY_TOKEN_FILE;
  const cli = async (args) =>
    JSON.parse(
      (
        await run(process.execPath, [resolve('apps/cli/dist/main.js'), ...args, '--json'], {
          env,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        })
      ).stdout,
    );
  const file = join(work, 'Game Build.zip');
  const build = randomBytes(9 * 1024 * 1024 + 5);
  await writeFile(file, build);
  const first = await cli(['put', file, 'builds/game/Game Build.zip']);
  assert.deepEqual([first.revision, first.created], [1, true]);
  // The same file again: nothing is uploaded, the revision stays.
  const again = await cli(['put', file, 'builds/game/Game Build.zip']);
  assert.deepEqual([again.revision, again.created, again.id], [1, false, first.id]);
  const output = join(work, 'copy.zip');
  await cli(['get', 'builds/game/Game Build.zip', output]);
  assert.equal(sha(await readFile(output)), sha(build));
});

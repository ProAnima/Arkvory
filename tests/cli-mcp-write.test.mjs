import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArkvoryClientError, ArkvoryHttpError, ArkvoryNetworkError } from '@proanima/arkvory-sdk';
import { pruneCheckpoints } from '../apps/cli/dist/mcp/checkpoints.js';
import { errorResult } from '../apps/cli/dist/mcp/output.js';
import { rootDirectory } from '../apps/cli/dist/mcp/paths.js';
import { HandleBlob, openSource } from '../apps/cli/dist/mcp/source.js';
import { publishFromRoot, uploadFromRoot, writeTarget } from '../apps/cli/dist/mcp/write-tools.js';
import { annotate, promote } from '../apps/cli/dist/mcp/stage-tools.js';
import { removeTestDirectory } from './helpers.mjs';

const KEY = 'arkvory_' + 'k'.repeat(40);
const ID = '00000000-0000-4000-8000-000000000001';
const call = (signal = new AbortController().signal) => ({ signal, progress: () => undefined });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const code = (error) => errorResult(error, new AbortController().signal).structuredContent.error;

/** A root with a checkpoint directory beside it, both removed after the test. */
async function workspace(t, write = {}) {
  const outer = await mkdtemp(join(tmpdir(), 'arkvory-mcpw-'));
  t.after(async () => {
    for (const name of ['out', 'link.bin', 'dir-link'])
      await rm(join(outer, 'root', name), { force: true });
    await removeTestDirectory(outer);
  });
  await mkdir(join(outer, 'root'));
  await mkdir(join(outer, 'checkpoints'));
  const root = await rootDirectory(join(outer, 'root'));
  const context = (client) => ({
    client,
    repository: 'releases',
    root,
    maxOutputBytes: 64 * 1024,
    secrets: [KEY],
    requestTimeoutMs: 1000,
    write: {
      repositories: null,
      checkpoints: join(outer, 'checkpoints'),
      server: 'https://arkvory.test/',
      ...write,
    },
  });
  return { outer, root, context };
}

/** An SDK stand-in for uploads: records calls; `tamper` changes the receipt's SHA-256. */
function uploads(options = {}) {
  const calls = [];
  const sessions = new Map();
  const session = (id, descriptor, status) => ({
    id,
    repository: 'releases',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    descriptor,
  });
  const client = {
    create: async (repository, key, descriptor) => {
      calls.push(['create', repository, key]);
      const id = `00000000-0000-4000-8000-${String(sessions.size + 2).padStart(12, '0')}`;
      sessions.set(id, { descriptor, done: false });
      return session(id, descriptor, 'pending');
    },
    status: async (repository, id) => {
      calls.push(['status', id]);
      const known = sessions.get(id);
      return session(id, known.descriptor, known.done ? 'available' : 'pending');
    },
    resume: async (repository, id, blob) => {
      calls.push(['resume', id]);
      if (options.fail) throw options.fail;
      const bytes = Buffer.from(await blob.arrayBuffer());
      const known = sessions.get(id);
      assert.equal(sha256(bytes), known.descriptor.sha256, 'the bytes sent are the bytes hashed');
      known.done = true;
      const sent = options.tamper
        ? { ...known.descriptor, sha256: 'f'.repeat(64) }
        : known.descriptor;
      return session(id, sent, 'available');
    },
    registerPackage: async (repository, id) => {
      calls.push(['registerPackage', id]);
      return { group: '', name: 'app', version: '1.0.0', artifactId: id };
    },
    asset: async () => {
      calls.push(['asset']);
      throw new ArkvoryHttpError(404, 'not_found', 'req-1');
    },
    setAsset: async (repository, path, artifactId, expectedRevision) => {
      calls.push(['setAsset', path, artifactId, expectedRevision]);
      return { path, revision: 1, artifactId };
    },
  };
  return { client, calls };
}

test('a source handle keeps serving the opened bytes, and fetch sends it as a sized body', async (t) => {
  const { root } = await workspace(t);
  await writeFile(join(root, 'a.bin'), 'hello arkvory');
  const source = await openSource(root, 'a.bin');
  t.after(() => source.handle.close());
  assert.equal(source.shown, 'a.bin');
  assert.equal(source.blob.size, 13);
  // The path now names other bytes; reads go through the handle that was checked.
  await rename(join(root, 'a.bin'), join(root, 'old.bin'));
  await writeFile(join(root, 'a.bin'), 'something else entirely');
  assert.equal(await source.blob.text(), 'hello arkvory');
  assert.equal(await source.blob.slice(6).text(), 'arkvory');
  assert.equal(await source.blob.slice(-7, -3).text(), 'arkv');
  assert.equal(source.blob.slice(5, 2).size, 0);
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () =>
      response.end(
        JSON.stringify({
          body: Buffer.concat(chunks).toString(),
          length: request.headers['content-length'],
        }),
      ),
    );
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/`;
  const sent = await (await fetch(url, { method: 'PUT', body: source.blob.slice(6) })).json();
  assert.deepEqual(sent, { body: 'arkvory', length: '7' });
  assert.ok(source.blob instanceof HandleBlob && source.blob instanceof Blob);
});

test('upload sources stay below the root: dot segments, links out, directories and FIFOs', async (t) => {
  const { outer, root } = await workspace(t);
  await mkdir(join(outer, 'elsewhere'));
  await writeFile(join(outer, 'elsewhere', 'secret.txt'), 'outside');
  await mkdir(join(root, 'inside'));
  await writeFile(join(root, 'inside', 'ok.bin'), 'ok');
  const refused = async (path, expected) =>
    assert.rejects(openSource(root, path), { code: expected }, path);
  await refused('../elsewhere/secret.txt', 'path_outside_root');
  await refused('inside/../../elsewhere/secret.txt', 'path_outside_root');
  await refused(join(outer, 'elsewhere', 'secret.txt'), 'path_outside_root');
  await refused('.', 'path_outside_root');
  await refused('inside', 'path_outside_root');
  await refused('missing.bin', 'file_not_found');
  await refused('a\0b', 'invalid_path');
  // A directory link (a junction on Windows needs no privilege) that leads out is followed.
  await symlink(join(outer, 'elsewhere'), join(root, 'out'), 'junction');
  await refused('out/secret.txt', 'path_outside_root');
  await symlink(join(root, 'inside'), join(root, 'dir-link'), 'junction');
  const viaLink = await openSource(root, 'dir-link/ok.bin');
  await viaLink.handle.close();
  assert.equal(viaLink.shown, 'inside/ok.bin', 'the real path is reported');
  const linked = await symlink(join(outer, 'elsewhere', 'secret.txt'), join(root, 'link.bin'))
    .then(() => true)
    .catch((error) => {
      assert.equal(process.platform, 'win32', String(error.code));
      assert.equal(error.code, 'EPERM');
      return false;
    });
  if (linked) await refused('link.bin', 'path_outside_root');
  if (process.platform !== 'win32') {
    await promisify(execFile)('mkfifo', [join(root, 'pipe')]);
    await refused('pipe', 'path_outside_root');
  }
  if (process.platform === 'win32') await refused('NUL', 'invalid_path');
});

test('writes outside --write-repositories are refused before any request', async (t) => {
  const { root, context } = await workspace(t, { repositories: new Set(['builds']) });
  await writeFile(join(root, 'a.bin'), 'bytes');
  const fake = uploads();
  const ctx = context(fake.client);
  assert.throws(() => writeTarget(ctx, undefined), { code: 'repository_not_allowed' });
  assert.equal(writeTarget(ctx, 'builds').repository, 'builds');
  assert.throws(() => writeTarget({ ...ctx, write: undefined }, 'builds'), {
    code: 'write_not_enabled',
  });
  for (const attempt of [
    () => uploadFromRoot(ctx, { file: 'a.bin' }, call()),
    () => publishFromRoot(ctx, { repository: 'other', file: 'a.bin' }, call()),
    () => promote(ctx, { id: ID, stage: 'release' }, call()),
    () => annotate(ctx, { id: ID, expectedRevision: 1, labels: [] }, call()),
  ])
    await assert.rejects(attempt(), { code: 'repository_not_allowed' });
  assert.deepEqual(fake.calls, []);
  assert.equal(code(new Error('x')).code, 'local_or_protocol_error');
});

test('an upload sends the hashed bytes, verifies the receipt and resumes by its checkpoint', async (t) => {
  const { outer, root, context } = await workspace(t);
  const bytes = Buffer.from('build 42 bytes');
  await writeFile(join(root, 'build.bin'), bytes);
  const fake = uploads();
  const ctx = context(fake.client);
  const input = { file: 'build.bin', labels: ['test'], metadata: { commit: 'abc' } };
  const first = await uploadFromRoot(ctx, input, call());
  assert.equal(first.sha256, sha256(bytes));
  assert.deepEqual([first.file, first.size, first.repository], ['build.bin', '14', 'releases']);
  assert.equal(first.artifact.status, 'available');
  assert.equal(first.artifact.checkpoint, undefined, 'no local path outside the root');
  assert.deepEqual(first.artifact.descriptor.labels, ['test']);
  // The checkpoint lives in the CLI home, never beside the source.
  assert.deepEqual(await readdir(root), ['build.bin']);
  assert.equal((await readdir(join(outer, 'checkpoints'))).length, 1);
  // The same call after a lost answer finds the checkpoint: no second upload is created.
  const again = await uploadFromRoot(ctx, input, call());
  assert.equal(again.artifact.id, first.artifact.id);
  assert.equal(fake.calls.filter(([name]) => name === 'create').length, 1);
  // Other labels or changed bytes are another publication, not a checkpoint mismatch.
  await uploadFromRoot(ctx, { ...input, labels: ['staging'] }, call());
  assert.equal(fake.calls.filter(([name]) => name === 'create').length, 2);
});

test('nothing builds on bytes that were not verified: no partial publish', async (t) => {
  const prepared = async () => {
    const space = await workspace(t);
    await writeFile(join(space.root, 'app.upack'), 'upack bytes');
    return space.context;
  };
  for (const options of [{ tamper: true }, { fail: new ArkvoryNetworkError('down') }]) {
    const context = await prepared();
    const fake = uploads(options);
    const ctx = context(fake.client);
    const expected = options.tamper ? 'integrity_mismatch' : 'network_failed';
    // One after the other: the same file and labels share one checkpoint and its lock.
    for (const attempt of [
      () => publishFromRoot(ctx, { file: 'app.upack' }, call()),
      () => uploadFromRoot(ctx, { file: 'app.upack', repositoryPath: 'apps/app.upack' }, call()),
    ]) {
      const error = await attempt().then(
        () => assert.fail('must fail'),
        (failure) => failure,
      );
      assert.equal(code(error).code, expected);
    }
    assert.deepEqual(
      fake.calls.filter(([name]) => name === 'registerPackage' || name === 'setAsset'),
      [],
      'no registration and no path revision after a failed or unverified upload',
    );
  }
  const context = await prepared();
  const fake = uploads();
  const published = await publishFromRoot(context(fake.client), { file: 'app.upack' }, call());
  assert.equal(published.package.version, '1.0.0');
  assert.equal(published.sha256, sha256(Buffer.from('upack bytes')));
  const placed = await uploadFromRoot(
    context(fake.client),
    { file: 'app.upack', repositoryPath: 'apps/app.upack' },
    call(),
  );
  assert.deepEqual([placed.path, placed.revision, placed.created], ['apps/app.upack', 1, true]);
});

test('a file that contains the key anywhere is never uploaded, at any size', async (t) => {
  const { root, context } = await workspace(t);
  const MiB = 1024 * 1024;
  const placed = (size, at) => {
    const bytes = Buffer.alloc(size, 0x61);
    if (at !== undefined) bytes.write(KEY, at, 'latin1');
    return bytes;
  };
  const files = {
    'notes.txt': Buffer.from(`token=${KEY}
`),
    // Past the first 64 KiB, inside the second read, and split across the seam of two reads.
    'padded.bin': placed(3 * MiB, 2 * MiB + 77),
    'seam.bin': placed(2 * MiB, MiB - 10),
    'tail.bin': placed(MiB + 5, MiB + 5 - KEY.length),
  };
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(join(root, name), bytes);
    const fake = uploads();
    await assert.rejects(
      uploadFromRoot(context(fake.client), { file: name }, call()),
      { code: 'source_contains_credential' },
      name,
    );
    assert.deepEqual(fake.calls, [], `${name}: nothing is sent`);
  }
  // A near miss at the seam is an ordinary file.
  const near = placed(2 * MiB, MiB - 10);
  near[MiB + 5] = 0x21;
  await writeFile(join(root, 'near.bin'), near);
  const fake = uploads();
  const done = await uploadFromRoot(context(fake.client), { file: 'near.bin' }, call());
  assert.equal(done.sha256, sha256(near));
});

test('a checkpoint of an expired or cancelled upload is replaced once, never reused for good', async (t) => {
  const { outer, root, context } = await workspace(t);
  await writeFile(join(root, 'build.bin'), 'build bytes');
  const fake = uploads();
  const ctx = context(fake.client);
  const input = { file: 'build.bin', labels: ['test'] };
  const resume = fake.client.resume;
  let stale = true;
  // The first session never finishes: the call fails and leaves its checkpoint.
  fake.client.resume = async () => {
    throw new ArkvoryNetworkError('down');
  };
  await assert.rejects(uploadFromRoot(ctx, input, call()), { name: 'ArkvoryNetworkError' });
  // Days later the server let it expire (or someone cancelled it).
  for (const failure of [
    new ArkvoryHttpError(409, 'conflict', 'req-1', undefined, { reason: 'upload_expired' }),
    new ArkvoryClientError('upload_cancelled', 'Upload is cancelled'),
  ]) {
    stale = true;
    fake.client.resume = async (repository, id, blob) => {
      if (stale) {
        stale = false;
        throw failure;
      }
      return resume(repository, id, blob);
    };
    const before = fake.calls.filter(([name]) => name === 'create').length;
    const done = await uploadFromRoot(ctx, input, call());
    assert.equal(done.artifact.status, 'available');
    const creates = fake.calls.filter(([name]) => name === 'create');
    assert.equal(creates.length, before + 1, 'one new upload');
    assert.notEqual(creates.at(-1)[2], creates.at(-2)[2], 'under a new idempotency key');
    // The finished upload is now the checkpoint: repeating returns it.
    assert.equal((await uploadFromRoot(ctx, input, call())).artifact.id, done.artifact.id);
    await rm(join(outer, 'checkpoints'), { recursive: true });
    await mkdir(join(outer, 'checkpoints'));
    fake.client.resume = async () => {
      throw new ArkvoryNetworkError('down');
    };
    await assert.rejects(uploadFromRoot(ctx, input, call()));
  }
  // An upload this call began itself is not restarted when it is cancelled meanwhile.
  await rm(join(outer, 'checkpoints'), { recursive: true });
  await mkdir(join(outer, 'checkpoints'));
  fake.client.resume = async () => {
    throw new ArkvoryClientError('upload_cancelled', 'Upload is cancelled');
  };
  const before = fake.calls.filter(([name]) => name === 'create').length;
  await assert.rejects(uploadFromRoot(ctx, input, call()), { code: 'upload_cancelled' });
  assert.equal(fake.calls.filter(([name]) => name === 'create').length, before + 1);
});

test('the checkpoint directory stays bounded and never loses a locked checkpoint', async (t) => {
  const { outer } = await workspace(t);
  const directory = join(outer, 'checkpoints');
  const now = Date.parse('2026-10-17T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const name = (n) => `${String(n).padStart(64, '0')}.json`;
  const make = async (file, age) => {
    await writeFile(join(directory, file), '{}');
    const when = new Date(now - age);
    await utimes(join(directory, file), when, when);
  };
  for (let n = 0; n < 5; n++) await make(name(n), n * day);
  await make(name(10), 40 * day);
  await make(name(11), 40 * day);
  await writeFile(join(directory, `${name(11)}.lock`), '{"pid":1}');
  await make(`${name(12)}.00000000-0000-4000-8000-000000000000.tmp`, 2 * day);
  await make(`${name(13)}.00000000-0000-4000-8000-000000000000.tmp`, 60 * 1000);
  await make('notes.txt', 400 * day);
  const removed = await pruneCheckpoints(directory, now, { ageMs: 30 * day, count: 3 });
  assert.deepEqual(removed.sort(), [
    name(3),
    name(4),
    name(10),
    `${name(12)}.00000000-0000-4000-8000-000000000000.tmp`,
  ]);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [
      name(0),
      name(1),
      name(11),
      `${name(11)}.lock`,
      `${name(13)}.00000000-0000-4000-8000-000000000000.tmp`,
      name(2),
      'notes.txt',
    ].sort(),
  );
});

test('a source that shrinks while it is read fails instead of sending other bytes', async (t) => {
  const { root } = await workspace(t);
  await writeFile(join(root, 'grow.bin'), Buffer.alloc(64, 1));
  const source = await openSource(root, 'grow.bin');
  t.after(() => source.handle.close());
  const handle = await open(join(root, 'grow.bin'), 'r+');
  await handle.truncate(10);
  await handle.close();
  await assert.rejects(source.blob.arrayBuffer(), { code: 'source_changed' });
});

test('promote checks the SHA-256 first; annotate keeps what it was not asked to change', async (t) => {
  const { context } = await workspace(t);
  const calls = [];
  const client = {
    artifact: async () => ({ descriptor: { sha256: 'a'.repeat(64) } }),
    promotions: {
      setStage: async (...args) => {
        calls.push(['setStage', ...args.slice(0, 4)]);
        return { stage: args[2] };
      },
    },
    annotations: async () => ({
      revision: 3,
      labels: ['old'],
      metadata: { commit: 'abc' },
      collections: ['desktop'],
    }),
    annotate: async (repository, id, revision, value) => {
      calls.push(['annotate', revision, value]);
      return { revision: revision + 1, ...value };
    },
  };
  const ctx = context(client);
  await assert.rejects(promote(ctx, { id: ID, stage: 'release', sha256: 'b'.repeat(64) }, call()), {
    name: 'ArkvoryIntegrityError',
  });
  assert.deepEqual(calls, [], 'other bytes are never promoted');
  const promoted = await promote(ctx, { id: ID, stage: 'release', sha256: 'a'.repeat(64) }, call());
  assert.equal(promoted.stage.stage, 'release');
  const annotated = await annotate(ctx, { id: ID, expectedRevision: 3, labels: ['new'] }, call());
  assert.deepEqual(calls.at(-1), [
    'annotate',
    3,
    { labels: ['new'], metadata: { commit: 'abc' }, collections: ['desktop'] },
  ]);
  assert.equal(annotated.annotations.revision, 4);
});

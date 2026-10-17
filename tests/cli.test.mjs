import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArguments } from '../apps/cli/dist/arguments.js';
import { upload } from '../apps/cli/dist/upload.js';
import { download } from '../apps/cli/dist/download.js';
import { moment } from '../apps/cli/dist/time-window.js';
import { exclusive, readSmall } from '../apps/cli/dist/local-files.js';
import { failure, failureText } from '../apps/cli/dist/errors.js';
import { ArkvoryClient, ArkvoryIntegrityError } from '@proanima/arkvory-sdk';
import { createServer } from 'node:http';
import { removeTestDirectory } from './helpers.mjs';

test('CLI rejects ambiguous options and preserves literal filenames', () => {
  assert.throws(() => parseArguments(['--token', 'secret']), { code: 'unknown_option' });
  assert.throws(() => parseArguments(['--json', '--json']), { code: 'duplicate_option' });
  assert.throws(() => parseArguments(['--lang', 'xx']), { code: 'invalid_language' });
  assert.deepEqual(parseArguments(['upload', '--', '-build.upack']).words, [
    'upload',
    '-build.upack',
  ]);
});

test('CLI upload persists idempotency before create and refuses a changed source', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const path = join(directory, 'build.bin');
  await writeFile(path, 'build');
  let created,
    key,
    first = true;
  const client = {
    async create(repository, selected, descriptor) {
      if (key) assert.equal(key, selected);
      key = selected;
      created = {
        id: 'test-id',
        repository,
        descriptor,
        status: 'pending',
        createdAt: '',
        expiresAt: '',
      };
      if (first) {
        first = false;
        throw Error('lost response');
      }
      return created;
    },
    async status() {
      return created;
    },
    async resume() {
      return { ...created, status: 'available' };
    },
  };
  const input = {
    client,
    path,
    server: 'https://arkvory.example/',
    repository: 'releases',
    signal: new AbortController().signal,
    progress() {},
  };
  await assert.rejects(upload(input), /lost response/);
  const checkpoint = JSON.parse(await readFile(path + '.arkvory-upload.json', 'utf8'));
  assert.equal(checkpoint.key, key);
  assert.equal(checkpoint.id, undefined);
  assert.equal((await upload(input)).status, 'available');
  assert.equal((await upload(input)).id, 'test-id');
  await writeFile(path, 'other');
  await assert.rejects(upload(input), { code: 'checkpoint_mismatch' });
  await assert.rejects(access(path + '.arkvory-upload.json.lock'), /ENOENT/);
});

test('CLI upload refuses a receipt for other bytes with the contract code, not a download text', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const path = join(directory, 'build.bin');
  await writeFile(path, 'build');
  const session = (descriptor, status) => ({
    id: 'test-id',
    repository: 'releases',
    descriptor,
    status,
    createdAt: '',
    expiresAt: '',
  });
  let receipt;
  const client = {
    create: async (repository, key, descriptor) => session(descriptor, 'pending'),
    status: async () => assert.fail('no checkpoint id yet'),
    resume: async () => receipt,
  };
  const input = {
    client,
    path,
    state: join(directory, 'state.json'),
    server: 'https://arkvory.example/',
    repository: 'releases',
    signal: new AbortController().signal,
    progress() {},
  };
  const descriptor = {
    name: 'build.bin',
    size: '5',
    sha256: createHash('sha256').update('build').digest('hex'),
    labels: [],
    metadata: {},
  };
  receipt = session(descriptor, 'available');
  assert.equal((await upload(input)).status, 'available', 'the matching receipt is accepted');
  for (receipt of [
    session({ ...descriptor, sha256: 'f'.repeat(64) }, 'available'),
    session({ ...descriptor, size: '6' }, 'available'),
    session(descriptor, 'pending'),
  ]) {
    await rm(input.state, { force: true });
    const error = await upload(input).then(
      () => assert.fail('must fail'),
      (e) => e,
    );
    const result = failure(error, false);
    assert.deepEqual([result.code, result.exitCode], ['integrity_mismatch', 5]);
    assert.doesNotMatch(failureText(result, 'en'), /download/i);
  }
});

test('CLI download publishes only a verified stream and never replaces a destination', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const output = join(directory, 'result.bin');
  const bytes = Buffer.from('verified payload');
  let corrupt = true;
  const client = {
    async artifact() {
      return {
        descriptor: {
          size: String(bytes.length),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    },
    async downloadVerified() {
      let sent = false;
      return new ReadableStream({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(bytes);
          } else if (corrupt) controller.error(new ArkvoryIntegrityError());
          else controller.close();
        },
      });
    },
  };
  const input = {
    client,
    output,
    server: 'https://arkvory.example/',
    repository: 'releases',
    id: 'artifact',
    signal: new AbortController().signal,
    progress() {},
  };
  await assert.rejects(download(input), ArkvoryIntegrityError);
  await assert.rejects(access(output), /ENOENT/);
  assert.equal((await readFile(output + '.arkvory-part')).length, 0);
  corrupt = false;
  await download(input);
  assert.deepEqual(await readFile(output), bytes);
  await assert.rejects(download(input), { code: 'destination_exists' });
});

test('CLI --class reaches the download and only known classes are accepted', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const bytes = Buffer.from('bulk payload');
  let asked;
  const client = {
    async artifact() {
      return {
        descriptor: {
          size: String(bytes.length),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    },
    async downloadVerified(repository, id, options) {
      asked = options.downloadClass;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
  };
  await download({
    client,
    output: join(directory, 'out.bin'),
    server: 'https://arkvory.example/',
    repository: 'releases',
    id: 'artifact',
    signal: new AbortController().signal,
    progress() {},
    downloadClass: 'bulk',
  });
  assert.equal(asked, 'bulk');
  assert.equal(
    parseArguments(['download', 'a', 'b', '--class', 'bulk']).options.get('class'),
    'bulk',
  );
});

test('CLI download windows read RFC 3339 or the next HH:MM', () => {
  const now = new Date(2026, 9, 14, 23, 0);
  assert.equal(
    moment('2026-10-15T06:00:00Z', now, 'not-after').toISOString(),
    '2026-10-15T06:00:00.000Z',
  );
  const tonight = moment('23:30', now, 'not-before');
  assert.deepEqual([tonight.getDate(), tonight.getHours(), tonight.getMinutes()], [14, 23, 30]);
  const tomorrow = moment('22:00', now, 'not-before');
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours()], [15, 22]);
  for (const wrong of ['24:00', '7:00', 'tonight', '2026-10-15'])
    assert.throws(() => moment(wrong, now, 'not-before'), { code: 'invalid_not_before' });
});

test('CLI keeps one download id in its checkpoint across processes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const bytes = Buffer.from('resumed payload');
  const ids = [];
  let fail = true;
  const client = {
    async artifact() {
      return {
        descriptor: {
          size: String(bytes.length),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    },
    async downloadVerified(repository, id, options) {
      ids.push(options.downloadId);
      if (fail) throw new Error('connection lost');
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
  };
  const input = {
    client,
    output: join(directory, 'out.bin'),
    server: 'https://arkvory.example/',
    repository: 'releases',
    id: 'artifact',
    signal: new AbortController().signal,
    progress() {},
  };
  await assert.rejects(download(input), /connection lost/);
  fail = false;
  await download(input);
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(ids[1], ids[0], 'a new process continues the same download');
});

test('CLI bounded local reads and concurrent checkpoint ownership fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-cli-'));
  t.after(() => removeTestDirectory(directory));
  const state = join(directory, 'state');
  await writeFile(state, '12345');
  await assert.rejects(readSmall(state, 4), { code: 'invalid_local_file' });
  await exclusive(state, async () => {
    await assert.rejects(
      exclusive(state, async () => {}),
      { code: 'state_locked' },
    );
  });
});

test('SDK client cancellation and deadlines include management response bodies', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const timed = new ArkvoryClient(url, () => 'test', { requestTimeoutMs: 100 });
  await assert.rejects(timed.list('releases'), { name: 'TimeoutError' });
  const abort = new AbortController();
  const client = new ArkvoryClient(url, () => 'test', { signal: abort.signal });
  const pending = client.list('releases');
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArguments } from '../apps/cli/dist/arguments.js';
import { upload } from '../apps/cli/dist/upload.js';
import { download } from '../apps/cli/dist/download.js';
import { exclusive, readSmall } from '../apps/cli/dist/local-files.js';
import { DepotClient, DepotIntegrityError } from '@proanima/depot-sdk';
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
  const directory = await mkdtemp(join(tmpdir(), 'depot-cli-'));
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
    server: 'https://depot.example/',
    repository: 'releases',
    signal: new AbortController().signal,
    progress() {},
  };
  await assert.rejects(upload(input), /lost response/);
  const checkpoint = JSON.parse(await readFile(path + '.depot-upload.json', 'utf8'));
  assert.equal(checkpoint.key, key);
  assert.equal(checkpoint.id, undefined);
  assert.equal((await upload(input)).status, 'available');
  assert.equal((await upload(input)).id, 'test-id');
  await writeFile(path, 'other');
  await assert.rejects(upload(input), { code: 'checkpoint_mismatch' });
  await assert.rejects(access(path + '.depot-upload.json.lock'), /ENOENT/);
});

test('CLI download publishes only a verified stream and never replaces a destination', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-cli-'));
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
          } else if (corrupt) controller.error(new DepotIntegrityError());
          else controller.close();
        },
      });
    },
  };
  const input = {
    client,
    output,
    server: 'https://depot.example/',
    repository: 'releases',
    id: 'artifact',
    signal: new AbortController().signal,
    progress() {},
  };
  await assert.rejects(download(input), DepotIntegrityError);
  await assert.rejects(access(output), /ENOENT/);
  assert.equal((await readFile(output + '.depot-part')).length, 0);
  corrupt = false;
  await download(input);
  assert.deepEqual(await readFile(output), bytes);
  await assert.rejects(download(input), { code: 'destination_exists' });
});

test('CLI bounded local reads and concurrent checkpoint ownership fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-cli-'));
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
  const timed = new DepotClient(url, () => 'test', { requestTimeoutMs: 100 });
  await assert.rejects(timed.list('releases'), { name: 'TimeoutError' });
  const abort = new AbortController();
  const client = new DepotClient(url, () => 'test', { signal: abort.signal });
  const pending = client.list('releases');
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

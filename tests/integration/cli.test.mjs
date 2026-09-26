import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, stat, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { upload } from '../../apps/cli/dist/upload.js';
import { download } from '../../apps/cli/dist/download.js';
import { setup } from './fixture.mjs';

test('remote CLI profiles, transfers across process restarts, metadata CAS and credentials', async (t) => {
  const f = await setup(t),
    server = (await f.listen()) + '/';
  const token = f.headers.authorization.slice(7),
    tokenFile = join(f.directory, 'key');
  await writeFile(tokenFile, token, { mode: 0o600 });
  const env = { ...process.env, ARKVORY_CLI_HOME: join(f.directory, 'cli') };
  for (const key of ['ARKVORY_TOKEN', 'ARKVORY_TOKEN_FILE', 'ARKVORY_BASE_URL']) delete env[key];
  const run = async (args, overrides = {}, expected = 0) => {
    let result;
    try {
      result = await promisify(execFile)(
        process.execPath,
        [resolve('apps/cli/dist/main.js'), ...args, '--json'],
        {
          env: { ...env, ...overrides },
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      assert.equal(expected, 0);
    } catch (error) {
      assert.equal(error.code, expected);
      result = error;
    }
    assert.equal((result.stdout + result.stderr).includes(token), false);
    return JSON.parse(expected ? result.stderr : result.stdout);
  };
  await run(['profile', 'add', 'local', '--server', server, '--token-file', tokenFile]);
  const profileBytes = await readFile(join(env.ARKVORY_CLI_HOME, 'profiles.json'), 'utf8');
  assert.equal(profileBytes.includes(token), false);
  assert.equal((await run(['doctor'])).server, server);
  assert.equal(
    (await run(['doctor'], { ARKVORY_BASE_URL: server }, 3)).error.code,
    'credential_required',
  );

  const path = join(f.directory, 'large build.bin'),
    bytes = Buffer.alloc(9 * 1024 ** 2, 73);
  await writeFile(path, bytes);
  const client = new ArkvoryClient(server, () => token);
  const abortedUpload = new AbortController();
  await assert.rejects(
    upload({
      client,
      server,
      repository: 'releases',
      path,
      signal: abortedUpload.signal,
      progress() {
        abortedUpload.abort();
      },
    }),
    { name: 'AbortError' },
  );
  const receipt = await run(['upload', path]);
  assert.equal(receipt.status, 'available');
  assert.equal((await run(['upload', path])).id, receipt.id);
  const output = join(f.directory, 'downloaded.bin');
  const abortedDownload = new AbortController();
  await assert.rejects(
    download({
      client,
      server,
      repository: 'releases',
      id: receipt.id,
      output,
      signal: abortedDownload.signal,
      progress() {
        abortedDownload.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal((await stat(output + '.arkvory-part')).size, 8 * 1024 ** 2);
  await assert.rejects(access(output), /ENOENT/);
  await run(['download', receipt.id, output]);
  assert.equal(
    createHash('sha256')
      .update(await readFile(output))
      .digest('hex'),
    receipt.descriptor.sha256,
  );
  assert.equal(
    (await run(['download', receipt.id, output], {}, 6)).error.code,
    'destination_exists',
  );
  const annotations = join(f.directory, 'annotations.json');
  await writeFile(
    annotations,
    JSON.stringify({ labels: ['test'], metadata: { commit: 'revision-a' }, collections: ['ci'] }),
  );
  assert.equal(
    (await run(['annotations', 'set', receipt.id, '--revision', '0', '--file', annotations]))
      .revision,
    1,
  );
  assert.equal(
    (await run(['annotations', 'set', receipt.id, '--revision', '0', '--file', annotations], {}, 6))
      .error.status,
    409,
  );
  assert.equal((await run(['search', '--label', 'test'])).items[0].id, receipt.id);
  assert.equal((await run(['list'], { ARKVORY_TOKEN: 'invalid-credential' }, 3)).error.status, 401);
});

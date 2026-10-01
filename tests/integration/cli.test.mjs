import { ZipFile } from 'yazl';
import { publishPackage } from '../../apps/cli/dist/publish-package.js';
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
  assert.equal((await run(['search', '--query', 'REVISION-A'])).items[0].id, receipt.id);
  assert.equal(
    (await run(['search', '--metadata-key', 'commit', '--metadata-value', 'revision-a'])).items[0]
      .id,
    receipt.id,
  );
  assert.equal(
    (await run(['search', '--metadata-key', 'commit', '--metadata-value', 'REVISION-A'])).items
      .length,
    0,
  );
  assert.equal(
    (await run(['search', '--metadata-key', 'commit'], {}, 2)).error.code,
    'metadata_pair_required',
  );
  const archive = new ZipFile();
  archive.addBuffer(
    Buffer.from(JSON.stringify({ name: 'cli-package', version: '1.0.0' })),
    'upack.json',
  );
  archive.addBuffer(Buffer.from('build'), 'package/build.txt');
  archive.end();
  const chunks = [];
  for await (const chunk of archive.outputStream) chunks.push(chunk);
  const packagePath = join(f.directory, 'build.upack');
  await writeFile(packagePath, Buffer.concat(chunks));
  // Commit registration, then lose the response: retry must reuse both artifact and version.
  const register = client.registerPackage.bind(client);
  let registeredId;
  client.registerPackage = async (...args) => {
    await register(...args);
    registeredId = args[1];
    throw new Error('lost response');
  };
  await assert.rejects(
    publishPackage({
      client,
      server,
      repository: 'releases',
      path: packagePath,
      signal: new AbortController().signal,
      progress() {},
    }),
    (error) => error.artifactId === registeredId,
  );
  const published = await run(['packages', 'publish', packagePath]);
  assert.equal(published.artifactId, registeredId);
  assert.equal(published.package.name, 'cli-package');
  assert.equal((await run(['packages', 'publish', packagePath])).artifactId, published.artifactId);
  assert.equal((await run(['packages', 'list'])).items.length, 1);
  const invalid = await run(['packages', 'publish', path], {}, 4);
  assert.equal(invalid.error.stage, 'register');
  assert.equal(invalid.error.artifactId, receipt.id);
  assert.equal((await run(['list'], { ARKVORY_TOKEN: 'invalid-credential' }, 3)).error.status, 401);
});

test('CLI promotes between repositories and downloads the staged version by range', async (t) => {
  const token = 'cli-promote-' + createHash('sha256').update(String(Math.random())).digest('hex');
  const f = await setup(t, {
    keys: [
      {
        sha256: createHash('sha256').update(token).digest('hex'),
        principal: { id: 'cli', repositories: ['dev', 'prod'], permissions: ['read', 'write'] },
      },
    ],
  });
  const server = (await f.listen()) + '/';
  const env = {
    ...process.env,
    ARKVORY_CLI_HOME: join(f.directory, 'cli'),
    ARKVORY_BASE_URL: server,
    ARKVORY_TOKEN: token,
  };
  delete env.ARKVORY_TOKEN_FILE;
  const run = async (args) => {
    const result = await promisify(execFile)(
      process.execPath,
      [resolve('apps/cli/dist/main.js'), ...args, '--json'],
      { env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(result.stdout);
  };
  const versions = {};
  for (const version of ['1.0.0', '1.4.0', '2.0.0']) {
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify({ name: 'app', version })), 'upack.json');
    zip.addBuffer(Buffer.from('build ' + version), 'package/build.txt');
    zip.end();
    const chunks = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk);
    const file = join(f.directory, `app-${version}.upack`);
    await writeFile(file, Buffer.concat(chunks));
    versions[version] = { file, bytes: Buffer.concat(chunks) };
    const published = await run(['packages', 'publish', file, '--repository', 'dev']);
    versions[version].id = published.artifactId;
  }
  const promoted = await run([
    'promote',
    versions['1.4.0'].id,
    '--repository',
    'dev',
    '--to',
    'prod',
    '--stage',
    'release,canary',
    '--comment',
    'approved',
  ]);
  assert.equal(promoted.created, true);
  assert.deepEqual(promoted.stages, ['canary', 'release']);
  const resolved = await run([
    'packages',
    'resolve',
    'app',
    '--repository',
    'prod',
    '--range',
    '^1.0',
    '--stage',
    'release',
  ]);
  assert.equal(resolved.version, '1.4.0');
  // --version is the global client flag; exact package versions use --exact.
  const exact = await run([
    'packages',
    'resolve',
    'app',
    '--repository',
    'dev',
    '--exact',
    '1.0.0',
  ]);
  assert.equal(exact.version, '1.0.0');
  const output = join(f.directory, 'deployed.upack');
  await run(['packages', 'download', 'app', output, '--repository', 'prod', '--stage', 'release']);
  assert.deepEqual(await readFile(output), versions['1.4.0'].bytes);
  const journal = await run(['promotions', 'journal', '--repository', 'prod']);
  assert.deepEqual(
    journal.items.map((event) => event.action),
    ['stage.added', 'stage.added', 'received'],
  );
  await run(['stages', 'remove', promoted.artifactId, 'canary', '--repository', 'prod']);
  const staged = await run(['stages', 'list', promoted.artifactId, '--repository', 'prod']);
  assert.deepEqual(
    staged.map((entry) => entry.stage),
    ['release'],
  );
});

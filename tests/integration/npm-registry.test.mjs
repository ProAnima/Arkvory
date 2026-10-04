import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { removeTestDirectory } from '../helpers.mjs';
import { setup } from './fixture.mjs';

const run = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** npm's own CLI script, run by this Node (the .cmd shim needs a shell on Windows). */
function npmCli() {
  const node = dirname(process.execPath);
  const found = [
    process.env.npm_execpath,
    join(node, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(node, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((path) => path?.endsWith('npm-cli.js') && existsSync(path));
  assert.ok(found, 'npm CLI not found next to Node');
  return found;
}

/**
 * The real npm client with a configuration of its own: user config with the registry and the
 * Arkvory key as its token, a private cache, no global config, no audit or update checks.
 */
async function npmIn(work, registry, token) {
  const home = join(work, 'home');
  await mkdir(home, { recursive: true });
  const userconfig = join(home, '.npmrc');
  const nerf = registry.replace(/^https?:/, '');
  await writeFile(userconfig, `registry=${registry}\n${nerf}:_authToken=${token}\n`);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: join(home, 'global.npmrc'),
    npm_config_cache: join(work, 'cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_loglevel: 'error',
  };
  const cli = npmCli();
  return async (cwd, args) =>
    (
      await run(process.execPath, [cli, ...args], {
        cwd,
        env,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout.trim();
}

/** A Unity package: package.json with `unity` and `displayName`, a script and a binary asset. */
async function unityPackage(work, name, version, asset) {
  const directory = join(work, `${name.replace('/', '-')}-${version}`);
  await mkdir(join(directory, 'Runtime'), { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name,
      version,
      displayName: 'Arkvory Tools',
      description: 'Tools for builds',
      unity: '2022.3',
      keywords: ['arkvory', 'build'],
    }),
  );
  await writeFile(join(directory, 'Runtime', 'Tools.cs'), 'public static class Tools {}\n');
  await writeFile(join(directory, 'Runtime', 'Atlas.bin'), asset);
  return directory;
}

test('npm publishes, tags, searches and installs a Unity package from Arkvory', async (t) => {
  const f = await setup(t);
  const origin = new URL(await f.listen());
  const work = await mkdtemp(join(tmpdir(), 'arkvory-npm-'));
  t.after(() => removeTestDirectory(work));
  const registry = `${origin.origin}/npm/releases/`;
  const npm = await npmIn(work, registry, f.headers.authorization.slice(7));
  const first = randomBytes(600 * 1024);
  const second = randomBytes(300 * 1024);
  const v1 = await unityPackage(work, 'com.proanima.tools', '1.0.0', first);
  const v2 = await unityPackage(work, 'com.proanima.tools', '1.1.0', second);
  await npm(v1, ['publish']);
  await npm(v2, ['publish', '--tag', 'beta']);
  await assert.rejects(npm(v1, ['publish']), /cannot publish over/);

  // The server's own rules, below the client's check: a retried publish of the same tarball
  // succeeds without a change, other content for the version and a wrong checksum are refused.
  const pack = async (directory) => {
    const [packed] = JSON.parse(
      await npm(directory, ['pack', '--json', '--pack-destination', work]),
    );
    return readFile(join(work, packed.filename));
  };
  const put = (bytes, dist = {}) =>
    fetch(`${registry}com.proanima.tools`, {
      method: 'PUT',
      headers: { ...f.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'com.proanima.tools',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: 'com.proanima.tools', version: '1.0.0', dist } },
        _attachments: { 'x.tgz': { data: bytes.toString('base64'), length: bytes.length } },
      }),
    });
  const tarball = await pack(v1);
  assert.equal((await put(tarball)).status, 200);
  const wrong = await put(tarball, { shasum: '0'.repeat(40) });
  assert.equal((await wrong.json()).code, 'integrity_mismatch');
  await writeFile(join(v1, 'Runtime', 'Tools.cs'), 'changed\n');
  const other = await put(await pack(v1));
  assert.equal(other.status, 409);
  assert.match((await other.json()).error, /other content/);

  const tags = JSON.parse(await npm(work, ['view', 'com.proanima.tools', 'dist-tags', '--json']));
  assert.deepEqual(tags, { beta: '1.1.0', latest: '1.0.0' });
  await npm(work, ['dist-tag', 'add', 'com.proanima.tools@1.1.0', 'latest']);
  await npm(work, ['dist-tag', 'rm', 'com.proanima.tools', 'beta']);
  assert.match(await npm(work, ['dist-tag', 'ls', 'com.proanima.tools']), /^latest: 1\.1\.0$/);

  // The client verifies dist.integrity while it installs.
  const consumer = join(work, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"name":"consumer","private":true}');
  await npm(consumer, ['install', 'com.proanima.tools']);
  const installed = join(consumer, 'node_modules', 'com.proanima.tools');
  assert.equal(sha(await readFile(join(installed, 'Runtime', 'Atlas.bin'))), sha(second));
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  const locked = lock.packages['node_modules/com.proanima.tools'];
  assert.equal(locked.resolved, `${registry}com.proanima.tools/-/com.proanima.tools-1.1.0.tgz`);
  assert.match(locked.integrity, /^sha512-/);

  // Unity lists a scoped registry through /-/v1/search and reads `unity` from the packument.
  const search = JSON.parse(await npm(work, ['search', 'tools', '--json']));
  assert.deepEqual(
    search.map((item) => [item.name, item.version]),
    [['com.proanima.tools', '1.1.0']],
  );
  const listed = await fetch(`${registry}-/v1/search?text=&from=0&size=250`, {
    headers: f.headers,
  });
  assert.equal((await listed.json()).total, 1);
  const packument = await (
    await fetch(`${registry}com.proanima.tools`, { headers: f.headers })
  ).json();
  assert.equal(packument.versions['1.0.0'].unity, '2022.3');
  assert.equal(packument.versions['1.1.0'].displayName, 'Arkvory Tools');
  assert.equal(
    packument.versions['1.1.0'].dist.shasum,
    createHash('sha1')
      .update(
        await (
          await fetch(packument.versions['1.1.0'].dist.tarball, { headers: f.headers })
        ).bytes(),
      )
      .digest('hex'),
  );
});

test('scoped names, read keys and anonymous requests get npm answers', async (t) => {
  const f = await setup(t);
  const origin = new URL(await f.listen());
  const work = await mkdtemp(join(tmpdir(), 'arkvory-npm-'));
  t.after(() => removeTestDirectory(work));
  const registry = `${origin.origin}/npm/releases/`;
  const npm = await npmIn(work, registry, f.headers.authorization.slice(7));
  const scoped = await unityPackage(work, '@team/util', '0.1.0', randomBytes(1024));
  await npm(scoped, ['publish']);
  const encoded = await fetch(`${registry}@team%2futil`, { headers: f.headers });
  assert.equal((await encoded.json()).versions['0.1.0'].name, '@team/util');

  const anonymous = await fetch(`${registry}@team%2futil`);
  assert.equal(anonymous.status, 401);
  const refusal = await anonymous.json();
  assert.equal(refusal.code, 'unauthorized');
  assert.ok(refusal.error && refusal.request_id);
  assert.equal((await fetch(`${registry}com.missing.package`, { headers: f.headers })).status, 404);

  // A read key installs but never publishes or moves tags.
  const reader = await npmIn(
    join(work, 'reader'),
    registry,
    f.readerHeaders.authorization.slice(7),
  );
  const consumer = join(work, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"name":"consumer","private":true}');
  await reader(consumer, ['install', '@team/util']);
  const next = await unityPackage(work, '@team/util', '0.2.0', randomBytes(10));
  await assert.rejects(reader(next, ['publish']), /403/);
  await assert.rejects(reader(work, ['dist-tag', 'add', '@team/util@0.1.0', 'stable']), /403/);
  const unpublish = await fetch(`${registry}@team%2futil/-rev/1`, {
    method: 'DELETE',
    headers: f.headers,
  });
  assert.equal(unpublish.status, 405);
});

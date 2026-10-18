import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseDirectoryOf } from '../packages/resolution/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';

const library = resolve('packages/resolution/dist/index.js');

/** Planted code: it leaves a file beside itself if anything ever runs it. */
const planted =
  "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'ran'), '');\nmodule.exports = () => ({});\n";

/**
 * What a library inside the release sees when it probes for an optional dependency the
 * release does not ship (`cpu-features`, as ssh2 does on load), and for its own files.
 */
const probe = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const outcome = {};
const attempts = {
  require: () => require('cpu-features'),
  // Node 24 does not pass require.resolve through the hooks; loading the path it names does.
  resolved: () => require(require.resolve('cpu-features')),
  meta: () => import.meta.resolve('cpu-features'),
  own: () => require('own'),
  builtin: () => require('fs').constants && 'fs',
};
for (const [name, attempt] of Object.entries(attempts)) {
  try {
    const value = attempt();
    outcome[name] = typeof value === 'string' && !value.includes('cpu-features') ? value : 'reached';
  } catch (error) {
    outcome[name] = error.code;
  }
}
try { await import('cpu-features'); outcome.import = 'reached'; } catch (error) { outcome.import = error.code; }
console.log(JSON.stringify(outcome));
`;

const refused = {
  require: 'MODULE_NOT_FOUND',
  resolved: 'MODULE_NOT_FOUND',
  meta: 'ERR_MODULE_NOT_FOUND',
  own: 'own',
  builtin: 'fs',
  import: 'ERR_MODULE_NOT_FOUND',
};

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * A temporary tree: a release with its own dependency, and the three places Node also searches
 * for a bare name that other accounts may be able to write — `node_modules` of a parent
 * directory, `~/.node_modules` and `NODE_PATH`. Each test plants code where it needs it.
 */
async function tree(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-confine-'));
  t.after(() => removeTestDirectory(root));
  const release = join(root, 'releases', '1.2.3');
  await mkdir(join(release, 'node_modules', 'own'), { recursive: true });
  await writeFile(join(release, 'package.json'), '{"type":"module"}');
  await writeFile(join(release, 'node_modules/own/index.js'), "module.exports = 'own';\n");
  await writeFile(join(release, 'probe.mjs'), probe);
  const places = {
    parent: join(root, 'node_modules'),
    home: join(root, 'home', '.node_modules'),
    path: join(root, 'global'),
  };
  const plant = async (place) => {
    await mkdir(join(places[place], 'cpu-features'), { recursive: true });
    await writeFile(join(places[place], 'cpu-features', 'index.js'), planted);
  };
  const ran = async () => {
    const found = [];
    for (const [place, directory] of Object.entries(places)) {
      const marker = join(directory, 'cpu-features', 'ran');
      if (await exists(marker)) found.push(place);
      await rm(marker, { force: true });
    }
    return found;
  };
  // HOME on POSIX, USERPROFILE on Windows: where Node looks for ~/.node_modules.
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    NODE_PATH: places.path,
  };
  return { root, release, plant, ran, env };
}

/** Runs `body` as an ES module in a fresh process: hooks must never enter the test process. */
function child(body, env, cwd) {
  const code = `import * as confinement from ${JSON.stringify(pathToFileURL(library).href)};\n${body}`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function run(body, env, cwd) {
  const result = child(body, env, cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const importProbe = (release) =>
  `await import(${JSON.stringify(pathToFileURL(join(release, 'probe.mjs')).href)});\n`;
const confineTo = (release) =>
  `confinement.confineResolution(); confinement.allowResolutionUnder(${JSON.stringify(release)});\n`;

for (const place of ['parent', 'home', 'path']) {
  test(`a module planted in ${place} runs unconfined and is refused once confined`, async (t) => {
    const { root, release, plant, ran, env } = await tree(t);
    await plant(place);
    // The attack: an unconfined process runs the planted code when the release probes for it.
    assert.equal(run(importProbe(release), env, root).require, 'reached');
    assert.deepEqual(await ran(), [place]);
    assert.deepEqual(run(confineTo(release) + importProbe(release), env, root), refused);
    assert.deepEqual(await ran(), [], 'refused code must never run');
  });
}

test('before a root is allowed only built-ins resolve; roots are real absolute directories', async (t) => {
  const { root, release, env } = await tree(t);
  const result = child(
    `confinement.confineResolution();
const outcome = { builtin: typeof (await import('node:fs')).readFileSync };
try { await import(${JSON.stringify(pathToFileURL(join(release, 'probe.mjs')).href)}); } catch (error) { outcome.release = error.code; }
try { await import('data:text/javascript,export default 1'); } catch (error) { outcome.data = error.code; }
for (const [name, directory] of [['relative', 'releases'], ['filesystem', ${JSON.stringify(resolve('/'))}], ['missing', ${JSON.stringify(join(root, 'missing'))}]])
  try { confinement.allowResolutionUnder(directory); } catch (error) { outcome[name] = error.code ?? error.message; }
console.log(JSON.stringify(outcome));`,
    env,
    root,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    builtin: 'function',
    release: 'ERR_MODULE_NOT_FOUND',
    data: 'ERR_MODULE_NOT_FOUND',
    relative: 'A confinement root must be an absolute path',
    filesystem: 'A filesystem root cannot be a confinement root',
    missing: 'ENOENT',
  });
  const unconfined = child(`confinement.allowResolutionUnder(${JSON.stringify(release)});`, env);
  assert.notEqual(unconfined.status, 0);
  assert.match(unconfined.stderr, /Module resolution is not confined/);
});

test('a link inside the release that leads outside it is refused by its real path', async (t) => {
  const { root, release, env } = await tree(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'index.js'), planted);
  const link = join(release, 'node_modules', 'linked');
  await symlink(outside, link, 'junction');
  const body =
    confineTo(release) +
    `const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(pathToFileURL(join(release, 'probe.mjs')).href)});
try { require('linked'); console.log('"reached"'); } catch (error) { console.log(JSON.stringify(error.code)); }`;
  try {
    assert.equal(run(body, env, root), 'MODULE_NOT_FOUND');
    assert.equal(await exists(join(outside, 'ran')), false);
  } finally {
    // Before the tree goes: a recursive removal does not take a Windows junction.
    await unlink(link);
  }
});

test('Windows compares roots without case; two copies of the package share one hook', async (t) => {
  const { root, release, env } = await tree(t);
  if (process.platform === 'win32')
    assert.equal(
      run(
        `confinement.confineResolution(); confinement.allowResolutionUnder(${JSON.stringify(release.toUpperCase())});\n` +
          importProbe(release),
        env,
        root,
      ).own,
      'own',
    );
  // launcher.mjs bundles one copy and the release entry it imports has its own: a second hook
  // with its own empty roots would refuse the release the first one allowed.
  const copy = join(root, 'bundle');
  await mkdir(copy);
  await writeFile(join(copy, 'package.json'), '{"type":"module"}');
  await copyFile(library, join(copy, 'index.js'));
  const body =
    `const second = await import(${JSON.stringify(pathToFileURL(join(copy, 'index.js')).href)});\n` +
    'second.confineResolution();\n' +
    confineTo(release) +
    'second.confineResolution();\n' +
    importProbe(release);
  assert.deepEqual(run(body, env, root), refused);
});

test('the release of an unbundled entry is three levels above it; a bundle has none', () => {
  const release = resolve('/srv/arkvory/releases/1.2.3');
  const url = (path) => pathToFileURL(join(release, path)).href;
  assert.equal(releaseDirectoryOf(url('apps/api/dist/confine.js')), release);
  assert.equal(releaseDirectoryOf(url('deploy/launcher.mjs')), undefined);
  assert.equal(releaseDirectoryOf(url('apps/api/src/confine.ts')), undefined);
  assert.equal(releaseDirectoryOf(url('tools/api/dist/confine.js')), undefined);
  assert.equal(
    releaseDirectoryOf(pathToFileURL(resolve('/tmp/arkvory-setup.mjs')).href),
    undefined,
  );
  assert.equal(releaseDirectoryOf('data:text/javascript,0'), undefined);
});

test('the environment adds no root: only the release of the entry resolves', async (t) => {
  const { root, release, plant, ran, env } = await tree(t);
  await plant('parent');
  // The API entry of this checkout allows its own release; a directory named by a variable of
  // the environment (once ARKVORY_MODULES_DIR) holds no code the services load and is no root.
  const api = pathToFileURL(resolve('apps/api/dist/confine.js')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(api)});
let outcome;
try { await import(${JSON.stringify(pathToFileURL(join(release, 'probe.mjs')).href)}); outcome = 'reached'; } catch (error) { outcome = error.code; }
console.log(JSON.stringify(outcome));`,
    ],
    { cwd: root, env: { ...env, ARKVORY_MODULES_DIR: root }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)), 'ERR_MODULE_NOT_FOUND');
  assert.deepEqual(await ran(), [], 'refused code must never run');
});

/** A fake installation whose release entries probe for `cpu-features` like ssh2 does. */
async function installation(t) {
  const fixture = await tree(t);
  const { root, release } = fixture;
  const recorded = `import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
let outcome = 'reached';
try { createRequire(import.meta.url)('cpu-features'); } catch (error) { outcome = error.code; }
writeFileSync(new URL('outcome.json', import.meta.url), JSON.stringify(outcome));
`;
  for (const entry of ['apps/api/dist/migrate.js', 'apps/deploy/dist/main.js']) {
    await mkdir(join(release, entry, '..'), { recursive: true });
    await writeFile(join(release, entry), recorded);
  }
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'config/runtime.json'), '{}');
  await writeFile(
    join(root, 'installation.json'),
    JSON.stringify({
      format: 1,
      mode: 'systemd',
      engine: 'docker',
      automatic: false,
      pin: null,
      current: {
        format: 1,
        version: '1.2.3',
        commit: 'a'.repeat(40),
        schema: 1,
        archiveSha256: 'b'.repeat(64),
        setupSha256: 'c'.repeat(64),
      },
    }),
  );
  const outcome = async (entry) =>
    JSON.parse(await readFile(join(release, entry, '..', 'outcome.json'), 'utf8'));
  return { ...fixture, outcome };
}

test('the service launcher and the deploy CLI loader confine the release they start', async (t) => {
  const { root, release, plant, ran, env, outcome } = await installation(t);
  for (const place of ['parent', 'home', 'path']) await plant(place);
  const node = (args) =>
    spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
  // An entry started without the launcher, without its own confinement: the attack succeeds.
  assert.equal(node([join(release, 'apps/api/dist/migrate.js')]).status, 0);
  assert.equal(await outcome('apps/api/dist/migrate.js'), 'reached');
  assert.deepEqual(await ran(), ['parent']);
  // The same entry under the launcher of the services (root/launcher.mjs, ADR 0031).
  const launched = node([resolve('apps/deploy/dist/launch.js'), root, 'migrate']);
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(await outcome('apps/api/dist/migrate.js'), 'MODULE_NOT_FOUND');
  // `arkvory` (root/manage.mjs) loads the deployment code of the current release.
  const managed = node([resolve('apps/deploy/dist/manage.js'), '--root', root]);
  assert.equal(managed.status, 0, managed.stderr);
  assert.equal(await outcome('apps/deploy/dist/main.js'), 'MODULE_NOT_FOUND');
  assert.deepEqual(await ran(), [], 'refused code must never run');
});

/**
 * Every shipped Node.js entry, unbundled (`apps/<app>/dist/*.js`: services, containers, the
 * deploy CLI of a release) or bundled (`launcher.mjs`, `manage.mjs`, `arkvory-setup.mjs`, the
 * client files), must import its app's confinement before anything else.
 */
const entries = [
  'apps/api/src/main.ts',
  'apps/api/src/migrate.ts',
  'apps/worker/src/main.ts',
  'apps/worker/src/gc.ts',
  'apps/worker/src/scrub.ts',
  'apps/worker/src/license.ts',
  'apps/backup/src/main.ts',
  'apps/deploy/src/main.ts',
  'apps/deploy/src/container.ts',
  'apps/deploy/src/probe.ts',
  'apps/deploy/src/launch.ts',
  'apps/deploy/src/manage.ts',
  'apps/deploy/src/remote-main.ts',
  'apps/cli/src/main.ts',
];

test('every shipped entry imports its confinement first', async () => {
  const listed = new Set(entries);
  const named = new Set();
  const runtime = await readFile('apps/deploy/src/runtime.ts', 'utf8');
  for (const [, entry] of runtime.matchAll(/entry: '(apps\/[a-z]+)\/dist\/([a-z-]+)\.js'/g))
    named.add(entry);
  for (const [, app, file] of runtime.matchAll(/entry: '(apps\/[a-z]+)\/dist\/([a-z-]+)\.js'/g))
    named.add(`${app}/src/${file}.ts`);
  const packaging = await readFile('scripts/package-release.mjs', 'utf8');
  for (const [, entry] of packaging.matchAll(
    /entryPoints: \['(apps\/[a-z]+\/src\/[a-z-]+\.ts)'\]/g,
  ))
    named.add(entry);
  const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts;
  for (const command of Object.values(scripts))
    for (const [, app, file] of command.matchAll(/(apps\/[a-z]+)\/dist\/([a-z-]+)\.js/g))
      named.add(`${app}/src/${file}.ts`);
  for (const file of ['deploy/Dockerfile', 'deploy/compose.yml'])
    for (const [, app, file_] of (await readFile(file, 'utf8')).matchAll(
      /(apps\/[a-z]+)\/dist\/([a-z-]+)\.js/g,
    ))
      named.add(`${app}/src/${file_}.ts`);
  for (const entry of named) if (entry.endsWith('.ts')) assert.ok(listed.has(entry), entry);
  for (const entry of entries) {
    const source = await readFile(entry, 'utf8');
    const first = source.split('\n').find((line) => line.startsWith('import'));
    assert.equal(first, "import './confine.js';", entry);
    const confine = await readFile(join(entry, '..', 'confine.ts'), 'utf8');
    assert.match(confine, /^confineEntry\(import\.meta\.url\);$/m, entry);
  }
});

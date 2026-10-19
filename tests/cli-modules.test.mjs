import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectModulePackage, unsafeForUser } from '../packages/signing/dist/index.js';
import { parseArguments } from '../apps/cli/dist/arguments.js';
import { moduleCommand } from '../apps/cli/dist/modules/module-command.js';
import { loadClientModules } from '../apps/cli/dist/modules/module-loader.js';
import { clientHost } from '../apps/cli/dist/modules/module-store.js';
import {
  manifestOf,
  moduleManifestOf,
  openToEveryone,
  packageEntries,
  protectRoot,
  revocationList,
  temporaryDirectory,
  testHost,
  writePackage,
} from './module-fixtures.mjs';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const CLIENT = {
  side: 'client',
  roles: undefined,
  kind: 'transfer',
  entry: { arkvoryctl: 'files/main.mjs' },
};

/** The entry of a client module contributing one transfer extension; `body` replaces create. */
function clientSource(overrides = {}, body) {
  const manifest = moduleManifestOf({ ...CLIENT, ...overrides });
  delete manifest.roles;
  return Buffer.from(`const manifest = ${JSON.stringify(manifest)};
${body?.imports ?? ''}
export default {
  manifest,
  create(context) {
    ${body?.create ?? ''}
    return { transfer: [{ name: 'test-delta', versions: ['1.0.0', '2.0.0'], async download() { return null; } }] };
  },
};
`);
}

function clientPackage(signer, overrides = {}, files = {}) {
  return packageEntries({
    signer,
    manifest: { ...CLIENT, ...overrides },
    files: {
      'files/main.mjs': clientSource(overrides, files.body),
      'files/LICENSE.md': Buffer.from('# Terms\n'),
      ...(files.extra ?? {}),
    },
    ...(files.revocations ? { revocations: files.revocations } : {}),
  });
}

async function setup(t) {
  const keys = testHost();
  const home = await temporaryDirectory(t, 'arkvory-cli-modules-');
  // Closed like a user profile: a temporary folder may let other local accounts write.
  await protectRoot(home);
  const host = clientHost([keys.module.key], NOW);
  const current = revocationList(keys.module, { sequence: 1, entries: [] });
  const revocations = join(home, 'list.json');
  await writeFile(revocations, current);
  const run = (...words) => moduleCommand(parseArguments(['module', ...words]), { home, host });
  const load = (profile = '', options = {}) =>
    loadClientModules(profile, AbortSignal.timeout(20_000), { home, host, ...options });
  return { keys, home, host, run, load, revocations };
}

test('a client package installs disabled, loads once enabled and gives its extension', async (t) => {
  const { keys, home, run, load, revocations } = await setup(t);
  await run('revocations', revocations);
  const file = await writePackage(home, clientPackage(keys.module));
  const shown = await run('install', file);
  assert.equal(shown.installed, false);
  assert.equal(shown.module.id, 'sample');
  assert.equal(shown.module.terms.text, '# Terms\n');
  assert.deepEqual((await run('list')).modules, []);
  const installed = await run('install', file, '--yes');
  assert.deepEqual([installed.installed, installed.enabledFor], [true, []]);
  assert.deepEqual(await load(), { extensions: [], loaded: [], refused: [] });
  await run('enable', 'sample', '--profile', 'prod');
  assert.equal((await load('dev')).extensions.length, 0);
  const loaded = await load('prod');
  assert.deepEqual(loaded.loaded, [{ id: 'sample', version: '1.0.0' }]);
  assert.equal(loaded.extensions[0].name, 'test-delta');
  assert.equal(await loaded.extensions[0].download({}, AbortSignal.timeout(1000)), null);
  await run('enable', 'sample');
  assert.equal((await load('')).extensions.length, 1);
  await run('disable', 'sample');
  assert.equal((await load('prod')).extensions.length, 0);
  assert.deepEqual(await run('remove', 'sample'), { removed: 'sample', version: '1.0.0' });
  assert.deepEqual((await run('list')).modules, []);
});

test('only client packages signed by a ProAnimaStudio module key are accepted', async (t) => {
  const { keys, home, run, revocations, host } = await setup(t);
  await run('revocations', revocations);
  const server = await writePackage(home, packageEntries({ signer: keys.module }), 'server.tgz');
  await assert.rejects(run('install', server), { code: 'side_mismatch' });
  const client = await writePackage(home, clientPackage(keys.module), 'client.tgz');
  // A server host (no side given) refuses the client package the same way.
  await assert.rejects(inspectModulePackage(client, keys.host), { code: 'side_mismatch' });
  const operator = await writePackage(
    home,
    clientPackage(keys.operator, { id: 'op-acme-x', publisher: 'acme' }),
    'op.tgz',
  );
  await assert.rejects(run('install', operator), { code: 'unknown_key' });
  for (const [overrides, pointer] of [
    [{ roles: ['api'] }, '/roles'],
    [{ routePrefixes: ['/x/'] }, '/routePrefixes'],
    [{ uses: ['routes'] }, '/uses'],
    // Capability values and a data directory exist only in server processes (ADR 0083, N6, N13).
    [{ optional: ['cache@^0.3.0'] }, '/optional'],
    [{ exposeTo: ['signed'] }, '/exposeTo'],
    [{ resources: { dataMiB: 1, dataFiles: 1 } }, '/resources'],
    [{ dataClass: 'auxiliary' }, '/dataClass'],
    [{ entry: { api: 'files/main.mjs' } }, '/entry/api'],
  ]) {
    const bad = await writePackage(home, clientPackage(keys.module, overrides), 'bad.tgz');
    await assert.rejects(
      inspectModulePackage(bad, host),
      (error) => error.code === 'manifest_invalid' && error.subject.endsWith(pointer),
      pointer,
    );
  }
  assert.equal(manifestOf().side, 'server');
});

test('revocation lists and stale lists decide installs; a revoked module never loads', async (t) => {
  const { keys, home, run, load } = await setup(t);
  const file = await writePackage(home, clientPackage(keys.module));
  await assert.rejects(run('install', file, '--yes'), { code: 'stale_revocations' });
  const stale = await run('install', file, '--yes', '--allow-stale-revocations');
  assert.equal(stale.staleRevocations, true);
  await run('enable', 'sample');
  assert.equal((await load()).loaded.length, 1);
  const revoking = join(home, 'revoked.json');
  await writeFile(
    revoking,
    revocationList(keys.module, {
      sequence: 2,
      entries: [
        { id: 'sample', versions: ['1.0.0'], reason: 'unsafe', readOnly: false, replacement: null },
      ],
    }),
  );
  assert.equal((await run('revocations', revoking)).stored, true);
  assert.deepEqual((await load()).refused, [
    { id: 'sample', version: '1.0.0', code: 'module_revoked' },
  ]);
  assert.equal((await run('list')).modules[0].revoked, true);
  await assert.rejects(run('install', file, '--yes'), { code: 'module_revoked' });
  // An older list never replaces a newer one.
  const older = join(home, 'older.json');
  await writeFile(older, revocationList(keys.module, { sequence: 1, entries: [] }));
  await assert.rejects(run('revocations', older), { code: 'revocation_rollback' });
});

test('a changed file, a mismatched descriptor or a failing module is refused alone', async (t) => {
  const { keys, home, run, load, revocations } = await setup(t);
  await run('revocations', revocations);
  await run('install', await writePackage(home, clientPackage(keys.module)), '--yes');
  await run('enable', 'sample');
  const entry = join(home, 'modules', 'sample', '1.0.0', 'files', 'main.mjs');
  const original = await readFile(entry);
  await writeFile(entry, Buffer.concat([original, Buffer.from('\n')]));
  assert.equal((await load()).refused[0].code, 'file_mismatch');
  await writeFile(entry, original);
  assert.equal((await load()).refused.length, 0);
  const other = await setup(t);
  await other.run('revocations', other.revocations);
  // The entry claims another version than the signed manifest.
  const relisted = packageEntries({
    signer: other.keys.module,
    manifest: CLIENT,
    files: {
      'files/main.mjs': clientSource({ version: '9.9.9' }),
      'files/LICENSE.md': Buffer.from('# Terms\n'),
    },
  });
  await other.run('install', await writePackage(other.home, relisted), '--yes');
  await other.run('enable', 'sample');
  assert.equal((await other.load()).refused[0].code, 'descriptor_mismatch');
});

test('client module code resolves only its own package', async (t) => {
  const { keys, home, run, load, revocations } = await setup(t);
  await run('revocations', revocations);
  // A package planted where Node would look for a bare name: above the module's directory.
  const planted = join(home, 'modules', 'node_modules', 'left-pad');
  await mkdir(planted, { recursive: true });
  await writeFile(join(planted, 'package.json'), '{"name":"left-pad","main":"index.js"}');
  await writeFile(join(planted, 'index.js'), 'globalThis.plantedRan = true; module.exports = 1;');
  await writeFile(join(home, 'modules', 'outside.mjs'), 'globalThis.outsideRan = true;');
  const cases = [
    ["import 'left-pad';", 'import_failed'],
    ["import '../../../outside.mjs';", 'import_failed'],
    ["import { helper } from './helper.mjs'; import { createHash } from 'node:crypto';", null],
  ];
  let version = 0;
  for (const [imports, code] of cases) {
    const v = `1.0.${++version}`;
    const entries = packageEntries({
      signer: keys.module,
      manifest: { ...CLIENT, version: v },
      files: {
        'files/main.mjs': clientSource({ version: v }, { imports }),
        'files/helper.mjs': Buffer.from('export const helper = 1;\n'),
      },
    });
    await run('install', await writePackage(home, entries, `p${v}.tgz`), '--yes');
    await run('enable', 'sample');
    const result = await load();
    assert.deepEqual(
      result.refused.map((r) => r.code),
      code ? [code] : [],
      imports,
    );
  }
  assert.equal(globalThis.plantedRan, undefined);
  assert.equal(globalThis.outsideRan, undefined);
});

/** Takes back the access `openToEveryone` gave. */
function closeAgain(path, mode = 0o644) {
  if (process.platform !== 'win32') return chmod(path, mode);
  execFileSync('icacls.exe', [path, '/remove:g', '*S-1-1-0'], { windowsHide: true });
}

test('module files others may change, or a linked package directory, are refused before any code runs', async (t) => {
  const { keys, home, run, load, revocations } = await setup(t);
  await run('revocations', revocations);
  await run('install', await writePackage(home, clientPackage(keys.module)), '--yes');
  await run('enable', 'sample');
  const directory = join(home, 'modules', 'sample', '1.0.0');
  // On Windows by its access rules, as the server loader reads them (ADR 0078, 3.3).
  for (const path of [
    join(directory, 'files', 'main.mjs'),
    join(home, 'modules', 'installed.json'),
    join(home, 'modules', 'module-revocations.json'),
  ]) {
    await openToEveryone(path);
    assert.deepEqual(
      (await load()).refused.map((m) => m.code),
      ['module_access'],
      path,
    );
    await closeAgain(path, path.endsWith('.json') ? 0o600 : 0o644);
  }
  assert.deepEqual((await load()).refused, []);
  // A link or junction anywhere in the package, not only at its top.
  const outside = join(home, 'outside');
  await mkdir(outside);
  const inner = join(directory, 'files', 'more');
  await symlink(outside, inner, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await load()).refused[0].code, 'module_access');
  await rm(inner, { recursive: false, force: true });
  // The package directory replaced by a link (a junction on Windows) to the same files.
  const moved = join(home, 'elsewhere');
  await rename(directory, moved);
  await symlink(moved, directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await load()).refused[0].code, 'module_access');
});

test('an access check that cannot run loads no client module', async (t) => {
  const { keys, home, run, load, revocations } = await setup(t);
  await run('revocations', revocations);
  await run('install', await writePackage(home, clientPackage(keys.module)), '--yes');
  await run('enable', 'sample');
  if (process.platform !== 'win32') {
    // Without PowerShell the Windows check cannot run: unverified, never safe.
    await assert.rejects(unsafeForUser([home], 'win32'), { code: 'access_unverified' });
    return;
  }
  const saved = process.env['SystemRoot'];
  t.after(() => {
    process.env['SystemRoot'] = saved;
  });
  process.env['SystemRoot'] = join(home, 'no-windows');
  assert.deepEqual(
    (await load()).refused.map((m) => m.code),
    ['module_access_unverified'],
  );
});

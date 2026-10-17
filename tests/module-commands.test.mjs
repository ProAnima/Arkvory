import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_API_VERSION } from '../packages/extension-api/dist/index.js';
import { minisignPublicKeyText } from '../packages/signing/dist/index.js';
import { moduleCommand } from '../apps/deploy/dist/module-commands.js';
import { checkReleaseRevocationKeys } from '../apps/deploy/dist/module-rotation.js';
import { recover } from '../apps/deploy/dist/operations.js';
import {
  defaultFiles,
  packageEntries,
  revocationList,
  temporaryDirectory,
  testHost,
  testKey,
  writePackage,
} from './module-fixtures.mjs';

const release = {
  format: 1,
  version: '0.6.0',
  commit: 'a'.repeat(40),
  schema: 43,
  archiveSha256: 'b'.repeat(64),
  setupSha256: 'c'.repeat(64),
};

/**
 * An installation with a current revocation list (sequence 1, valid until 2027-01-15) unless
 * `current` is false: installs need one (ADR 0078, 3.4).
 */
async function setup(t, { current = true } = {}) {
  const root = await temporaryDirectory(t, 'arkvory-module-root-');
  const files = await temporaryDirectory(t, 'arkvory-module-files-');
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
      current: release,
    }),
  );
  const keys = testHost();
  if (current)
    await writeFile(
      join(root, 'config/module-revocations.json'),
      revocationList(keys.module, { sequence: 1, entries: [] }),
    );
  const lines = [];
  const clock = { now: Date.parse('2026-10-17T12:00:00Z') };
  const context = {
    moduleKeys: [keys.module.key],
    licenseKeys: [keys.license.key],
    releaseKeys: [keys.release.key],
    extensionApi: EXTENSION_API_VERSION,
    now: () => clock.now,
    print: (line) => lines.push(line),
  };
  const run = (...args) => moduleCommand([...args, '--root', root], context);
  let count = 0;
  const pack = (options) =>
    writePackage(files, packageEntries({ signer: keys.module, ...options }), `p${++count}.tgz`);
  return { root, files, keys, lines, context, clock, run, pack };
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('install shows the package and its terms and changes nothing without --yes', async (t) => {
  const { root, lines, run, pack } = await setup(t);
  const file = await pack();
  await assert.rejects(run('install', file), /repeat with --yes/);
  assert.ok(lines.some((line) => line.includes('Module sample 1.0.0 (protocol)')));
  assert.ok(lines.includes('  | Test terms.'));
  await assert.rejects(readFile(join(root, 'modules/installed.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'journal.json')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(root, 'modules/.staging')), []);
});

test('install, upgrade, list and remove keep one previous package and journal each change', async (t) => {
  const { root, lines, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  let set = await readJson(join(root, 'modules/installed.json'));
  assert.deepEqual(
    set.modules.map((m) => [m.id, m.version, m.source, m.dataClass, m.pinned]),
    [['sample', '1.0.0', 'signed', 'none', false]],
  );
  const journal = await readJson(join(root, 'journal.json'));
  assert.equal(journal.phase, 'committed');
  assert.deepEqual(journal.modules.before, []);
  assert.equal(journal.modules.after[0].sha256, set.modules[0].sha256);
  assert.deepEqual((await readdir(join(root, 'modules/sample/1.0.0'))).sort(), [
    'files',
    'module.json',
    'module.json.minisig',
  ]);
  await run('install', await pack(), '--yes');
  assert.ok(lines.includes('Module sample 1.0.0 is already installed'));
  const other = { 'files/main.mjs': Buffer.from('export const other = 1;\n') };
  await assert.rejects(run('install', await pack({ files: other }), '--yes'), /different bytes/);
  await run('install', await pack({ manifest: { version: '1.1.0' } }), '--yes');
  set = await readJson(join(root, 'modules/installed.json'));
  assert.deepEqual(
    set.modules.map((m) => m.version),
    ['1.1.0'],
  );
  assert.deepEqual(
    set.retained.map((p) => p.version),
    ['1.0.0'],
  );
  lines.length = 0;
  await run('list');
  assert.match(
    lines[0],
    /^sample 1\.1\.0 {2}ok {2}data none {2}key [0-9a-f]{16} {2}sha256 [0-9a-f]{64}$/,
  );
  assert.ok(lines.includes('kept until the next change: sample 1.0.0'));
  assert.ok(
    lines.includes(
      'Revocation list: 1 of 2026-10-17T10:00:00Z, current until 2027-01-15T10:00:00Z',
    ),
  );
  await run('remove', 'sample');
  set = await readJson(join(root, 'modules/installed.json'));
  assert.deepEqual(set.modules, []);
  assert.deepEqual(
    set.retained.map((p) => p.version),
    ['1.1.0'],
  );
  // 1.0.0 was kept by the change before; the committed removal released it.
  await assert.rejects(stat(join(root, 'modules/sample/1.0.0')), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, 'modules/.packages/sample@1.0.0.tgz')), { code: 'ENOENT' });
  await stat(join(root, 'modules/.packages/sample@1.1.0.tgz'));
  await assert.rejects(run('remove', 'sample'), /not installed/);
});

test('pinned versions, downgrades and layout modules are refused unless the operator says so', async (t) => {
  const { run, pack } = await setup(t);
  await run('install', await pack({ manifest: { version: '2.0.0' } }), '--yes');
  await assert.rejects(
    run('install', await pack({ manifest: { version: '1.0.0' } }), '--yes'),
    /--downgrade/,
  );
  await assert.rejects(run('pin', 'sample', '1.0.0'), /pin the installed version/);
  await run('pin', 'sample', '2.0.0');
  await assert.rejects(
    run('install', await pack({ manifest: { version: '2.1.0' } }), '--yes'),
    /pinned to 2\.0\.0/,
  );
  await run('pin', 'sample', '--unpin');
  await run('install', await pack({ manifest: { version: '1.0.0' } }), '--yes', '--downgrade');
  await run('install', await pack({ manifest: { id: 'layout', dataClass: 'layout' } }), '--yes');
  await assert.rejects(run('remove', 'layout'), /module_owns_data/);
});

test('only ProAnimaStudio module keys install modules', async (t) => {
  const { root, run, files, keys } = await setup(t);
  await assert.rejects(
    run(
      'install',
      await writePackage(files, packageEntries({ signer: keys.release }), 'r.tgz'),
      '--yes',
    ),
    /wrong_key_class/,
  );
  await assert.rejects(
    run(
      'install',
      await writePackage(files, packageEntries({ signer: testKey() }), 'u.tgz'),
      '--yes',
    ),
    /unknown_key/,
  );
  // An operator key on the trust list signs plugins, which `module install` does not install.
  const pub = join(files, 'author.pub');
  await writeFile(pub, minisignPublicKeyText(keys.operator.key, 'minisign public key'));
  await run(
    'trust',
    'add',
    pub,
    '--label',
    'Acme platform team',
    '--plugins',
    'op-acme-*',
    '--yes',
  );
  const plugin = packageEntries({
    signer: keys.operator,
    manifest: { id: 'op-acme-scan', publisher: 'acme' },
  });
  await assert.rejects(
    run('install', await writePackage(files, plugin, 'o.tgz'), '--yes'),
    /arkvory plugin install/,
  );
  await assert.rejects(readFile(join(root, 'modules/installed.json')), { code: 'ENOENT' });
});

test('revocation lists only move forward and stop revoked versions', async (t) => {
  const { root, files, keys, lines, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  const entry = {
    id: 'sample',
    versions: ['1.0.0'],
    reason: 'read_path_defect',
    readOnly: true,
    replacement: '1.0.1',
  };
  const write = async (name, payload) => {
    const path = join(files, name);
    await writeFile(path, revocationList(keys.module, payload));
    return path;
  };
  await run('revocations', await write('r5.json', { sequence: 5, entries: [entry] }));
  assert.ok(lines.includes('Stored revocation list 5 (1 entries)'));
  await run('revocations', await write('r5b.json', { sequence: 5, entries: [entry] }));
  await assert.rejects(
    run('revocations', await write('r4.json', { sequence: 4, entries: [] })),
    /revocation_rollback/,
  );
  await assert.rejects(
    run('revocations', await write('r5c.json', { sequence: 5, entries: [] })),
    /revocation_conflict/,
  );
  lines.length = 0;
  await run('list');
  assert.match(lines[0], /^sample 1\.0\.0 {2}revoked \(read_path_defect\), read path only/);
  assert.ok(
    lines.includes(
      'Revocation list: 5 of 2026-10-17T10:00:00Z, current until 2027-01-15T10:00:00Z',
    ),
  );
  await run('remove', 'sample');
  await assert.rejects(
    run('install', await pack(), '--yes'),
    /module_revoked, read_path_defect\); install 1\.0\.1/,
  );
  // A package ships a newer list; it is kept even though this installation is not confirmed.
  const shipped = revocationList(keys.module, { sequence: 6, entries: [entry] });
  await assert.rejects(
    run('install', await pack({ manifest: { version: '1.0.1' }, revocations: shipped })),
    /--yes/,
  );
  const stored = await readFile(join(root, 'config/module-revocations.json'), 'utf8');
  assert.equal(stored, shipped);
  if (process.platform !== 'win32')
    assert.equal((await stat(join(root, 'config/module-revocations.json'))).mode & 0o777, 0o640);
});

test('an installed package changed on disk is reported, never trusted', async (t) => {
  const { root, lines, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  await writeFile(join(root, 'modules/sample/1.0.0/files/main.mjs'), 'export const value = 666;\n');
  await run('list');
  assert.match(lines.at(-2), /^sample 1\.0\.0 {2}refused: file_mismatch/);
  await writeFile(
    join(root, 'modules/sample/1.0.0/files/main.mjs'),
    defaultFiles()['files/main.mjs'],
  );
  await writeFile(join(root, 'modules/.packages/sample@1.0.0.tgz'), 'replaced');
  lines.length = 0;
  await run('list');
  assert.match(lines[0], /^sample 1\.0\.0 {2}refused: package_changed/);
});

test('an interrupted module change blocks the next one until recover restores the previous set', async (t) => {
  const { root, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  const before = await readJson(join(root, 'modules/installed.json'));
  await run('install', await pack({ manifest: { version: '1.1.0' } }), '--yes');
  const after = await readJson(join(root, 'modules/installed.json'));
  // As if the command stopped after writing the set and before committing the journal.
  await writeFile(
    join(root, 'journal.json'),
    JSON.stringify({
      phase: 'prepared',
      previous: release,
      next: release,
      modules: { before: before.modules, after: after.modules },
    }),
  );
  await assert.rejects(run('remove', 'sample'), /Interrupted deployment/);
  await recover(root);
  const restored = await readJson(join(root, 'modules/installed.json'));
  assert.deepEqual(restored.modules, before.modules);
  assert.deepEqual(restored.retained.map((p) => p.version).sort(), ['1.0.0', '1.1.0']);
  assert.equal((await readJson(join(root, 'journal.json'))).phase, 'recovered');
  await run('remove', 'sample');
});

test('operator keys are trusted only by a host command with a confirmed fingerprint', async (t) => {
  const { root, files, keys, lines, run } = await setup(t);
  const author = testKey();
  const pub = join(files, 'author.pub');
  await writeFile(pub, minisignPublicKeyText(author.key, 'minisign public key'));
  await assert.rejects(run('trust', 'add', pub, '--label', 'Acme'), /repeat with --yes/);
  assert.match(
    lines[0],
    new RegExp(`^Key ${author.id} {2}fingerprint ([0-9a-f]{4} ){15}[0-9a-f]{4}$`),
  );
  await assert.rejects(readFile(join(root, 'config/plugin-trust.json')), { code: 'ENOENT' });
  await assert.rejects(run('trust', 'add', pub, '--yes'), /--label/);
  await assert.rejects(
    run('trust', 'add', pub, '--label', 'Acme', '--plugins', 'acme-*', '--yes'),
    /trust_invalid/,
  );
  await assert.rejects(
    run('trust', 'add', pub, '--label', 'Acme', '--expires', '2026-01-01T00:00:00Z', '--yes'),
    /future/,
  );
  const moduleKey = minisignPublicKeyText(keys.module.key, 'x').split('\n')[1];
  await assert.rejects(
    run('trust', 'add', moduleKey, '--label', 'Not an author', '--yes'),
    /duplicate_key/,
  );
  await run(
    'trust',
    'add',
    pub,
    '--label',
    'Acme',
    '--plugins',
    'op-acme-*,op-tool',
    '--allow-in-process',
    '--expires',
    '2027-01-01T00:00:00Z',
    '--yes',
  );
  assert.ok(lines.some((line) => line.startsWith('Warning: in-process plugins')));
  const trust = await readJson(join(root, 'config/plugin-trust.json'));
  assert.deepEqual(trust.keys[0].plugins, ['op-acme-*', 'op-tool']);
  assert.equal(trust.keys[0].addedAt, '2026-10-17T12:00:00Z');
  if (process.platform !== 'win32')
    assert.equal((await stat(join(root, 'config/plugin-trust.json'))).mode & 0o777, 0o640);
  await assert.rejects(run('trust', 'add', pub, '--label', 'Again', '--yes'), /already trusted/);
  lines.length = 0;
  await run('trust', 'list');
  assert.ok(lines.includes('  plugins: op-acme-*, op-tool'));
  assert.ok(lines.includes('  expires: 2027-01-01T00:00:00Z'));
  await run('trust', 'remove', author.id);
  assert.deepEqual((await readJson(join(root, 'config/plugin-trust.json'))).keys, []);
  await assert.rejects(run('trust', 'remove', author.id), /No trusted key/);
});

test('module commands refuse unknown commands, options and argument counts', async (t) => {
  const { run } = await setup(t);
  await assert.rejects(run('enable', 'sample'), /Unknown module command/);
  await assert.rejects(run('trust', 'grant'), /Unknown module command/);
  await assert.rejects(run('install'), /takes 1 argument/);
  await assert.rejects(run('pin', 'sample'), /takes 2 argument/);
  await assert.rejects(run('list', '--yes'), /Unknown option --yes/);
  await assert.rejects(moduleCommand(['list']), /--root/);
});

test('the arkvory entry runs module commands with the built-in keys', async (t) => {
  const { root, pack } = await setup(t, { current: false });
  const main = join(import.meta.dirname, '../apps/deploy/dist/main.js');
  const list = spawnSync(process.execPath, [main, 'module', 'list', '--root', root], {
    encoding: 'utf8',
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /No modules are installed\./);
  // No ProAnimaStudio module key is built in yet: every package is refused before any change.
  const install = spawnSync(
    process.execPath,
    [main, 'module', 'install', await pack(), '--root', root, '--yes'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(install.status, 1);
  assert.match(install.stderr, /unknown_key/);
  await assert.rejects(readFile(join(root, 'modules/installed.json')), { code: 'ENOENT' });
});

test('the kept archive gets the installer mode, not the mode of the operator file', async (t) => {
  const { root, run, pack } = await setup(t);
  const file = await pack();
  await chmod(file, 0o666);
  await run('install', file, '--yes');
  const archive = join(root, 'modules/.packages/sample@1.0.0.tgz');
  if (process.platform !== 'win32') assert.equal((await stat(archive)).mode & 0o777, 0o644);
  else await stat(archive);
});

test('prerelease versions follow semver precedence and a removal keeps the downgrade guard', async (t) => {
  const { run, pack } = await setup(t);
  await run('install', await pack({ manifest: { version: '1.0.0-beta.9' } }), '--yes');
  // beta.10 is newer than beta.9 (numeric identifiers compare as numbers).
  await run('install', await pack({ manifest: { version: '1.0.0-beta.10' } }), '--yes');
  await assert.rejects(
    run('install', await pack({ manifest: { version: '1.0.0-beta.9' } }), '--yes'),
    /--downgrade/,
  );
  for (const [older, newer] of [
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
    ['1.0.0-beta.11', '1.0.0-rc.1'],
    ['1.0.0-rc.1', '1.0.0'],
  ]) {
    await run('install', await pack({ manifest: { id: 'order', version: newer } }), '--yes');
    await assert.rejects(
      run('install', await pack({ manifest: { id: 'order', version: older } }), '--yes'),
      /--downgrade/,
      `${older} < ${newer}`,
    );
    await run('remove', 'order');
    // The removed version is kept: installing an older one is still a downgrade.
    await assert.rejects(
      run('install', await pack({ manifest: { id: 'order', version: older } }), '--yes'),
      /--downgrade/,
      `${older} after removing ${newer}`,
    );
  }
});

test('trust and revocation commands wait for recover after an interrupted change', async (t) => {
  const { root, files, keys, run } = await setup(t, { current: false });
  const pub = join(files, 'author.pub');
  await writeFile(pub, minisignPublicKeyText(testKey().key, 'minisign public key'));
  const list = join(files, 'list.json');
  await writeFile(list, revocationList(keys.module, { sequence: 1, entries: [] }));
  await writeFile(
    join(root, 'journal.json'),
    JSON.stringify({ phase: 'prepared', previous: release, next: release }),
  );
  await assert.rejects(run('revocations', list), /Interrupted deployment/);
  await assert.rejects(
    run('trust', 'add', pub, '--label', 'Acme', '--yes'),
    /Interrupted deployment/,
  );
  await assert.rejects(run('trust', 'remove', '0123456789abcdef'), /Interrupted deployment/);
  await assert.rejects(readFile(join(root, 'config/plugin-trust.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'config/module-revocations.json')), {
    code: 'ENOENT',
  });
});

test('recover keeps the packages the interrupted change still had to keep', async (t) => {
  const { root, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  await run('install', await pack({ manifest: { version: '1.1.0' } }), '--yes');
  const before = await readJson(join(root, 'modules/installed.json'));
  await run('install', await pack({ manifest: { version: '1.2.0' } }), '--yes');
  const journal = await readJson(join(root, 'journal.json'));
  // As if the last change stopped after writing the set and before committing the journal.
  await writeFile(join(root, 'journal.json'), JSON.stringify({ ...journal, phase: 'prepared' }));
  await recover(root);
  const restored = await readJson(join(root, 'modules/installed.json'));
  assert.deepEqual(restored.modules, before.modules);
  // 1.0.0 was kept by the change before the interrupted one; it stays kept.
  assert.deepEqual(restored.retained.map((p) => p.version).sort(), ['1.0.0', '1.1.0', '1.2.0']);
});

test('a committed change removes packages that no set names, such as leftovers of a crash', async (t) => {
  const { root, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  // Placed by a change that stopped before its journal record, or half discarded.
  await mkdir(join(root, 'modules/sample/9.9.9/files'), { recursive: true });
  await writeFile(join(root, 'modules/.packages/sample@9.9.9.tgz'), 'orphan');
  await mkdir(join(root, 'modules/ghost/1.0.0'), { recursive: true });
  await writeFile(join(root, 'modules/.packages/ghost@1.0.0.tgz'), 'orphan');
  await writeFile(join(root, 'modules/notes.txt'), 'not ours');
  await run('install', await pack({ manifest: { version: '1.1.0' } }), '--yes');
  for (const gone of [
    'modules/sample/9.9.9',
    'modules/.packages/sample@9.9.9.tgz',
    'modules/ghost',
    'modules/.packages/ghost@1.0.0.tgz',
  ])
    await assert.rejects(stat(join(root, gone)), { code: 'ENOENT' }, gone);
  for (const kept of [
    'modules/sample/1.0.0/module.json',
    'modules/sample/1.1.0/module.json',
    'modules/.packages/sample@1.0.0.tgz',
    'modules/.packages/sample@1.1.0.tgz',
    'modules/notes.txt',
  ])
    await stat(join(root, kept));
});

const readLines = async (path) =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

test('install needs a current revocation list unless the operator accepts a stale one', async (t) => {
  const { root, files, keys, lines, run, pack } = await setup(t, { current: false });
  await assert.rejects(
    run('install', await pack(), '--yes'),
    /stale_revocations.*no revocation list/,
  );
  await assert.rejects(readFile(join(root, 'modules/installed.json')), { code: 'ENOENT' });
  // An expired list with a higher number is stored (it is the newest known), but stays stale.
  const expired = join(files, 'expired.json');
  await writeFile(
    expired,
    revocationList(keys.module, {
      sequence: 2,
      entries: [],
      issuedAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-01T00:00:00Z',
    }),
  );
  await run('revocations', expired);
  assert.ok(
    lines.some((line) =>
      line.startsWith('Warning: revocation list 2 expired at 2026-09-01T00:00:00Z'),
    ),
  );
  await assert.rejects(
    run('install', await pack(), '--yes'),
    /stale_revocations.*list 2 expired at 2026-09-01T00:00:00Z/,
  );
  lines.length = 0;
  await run('install', await pack(), '--yes', '--allow-stale-revocations');
  assert.ok(
    lines.some((line) => line.startsWith('Warning: installing with a stale revocation list')),
  );
  const audit = await readLines(join(root, 'modules/audit.jsonl'));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event, 'stale_revocations_allowed');
  assert.equal(audit[0].command, 'install');
  assert.equal(audit[0].module, 'sample');
  assert.equal(audit[0].version, '1.0.0');
  assert.equal(audit[0].sequence, 2);
  assert.equal(audit[0].expiresAt, '2026-09-01T00:00:00Z');
  assert.equal(audit[0].at, '2026-10-17T12:00:00.000Z');
  assert.equal((await readJson(join(root, 'journal.json'))).modules.staleRevocations, true);
  // A package that ships a current list makes installs current again without the option.
  const shipped = revocationList(keys.module, { sequence: 3, entries: [] });
  await run(
    'install',
    await pack({ manifest: { version: '1.1.0' }, revocations: shipped }),
    '--yes',
  );
  assert.equal((await readLines(join(root, 'modules/audit.jsonl'))).length, 1);
});

test('a stale list blocks pins but never stops what is installed', async (t) => {
  const { root, lines, clock, run, pack } = await setup(t);
  await run('install', await pack(), '--yes');
  clock.now = Date.parse('2027-02-01T00:00:00Z');
  await assert.rejects(run('pin', 'sample', '1.0.0'), /stale_revocations/);
  await run('pin', 'sample', '1.0.0', '--allow-stale-revocations');
  assert.equal((await readLines(join(root, 'modules/audit.jsonl')))[0].command, 'pin');
  await run('pin', 'sample', '--unpin');
  lines.length = 0;
  await run('list');
  assert.match(lines[0], /^sample 1\.0\.0 {2}ok /);
  assert.ok(
    lines.includes(
      'Revocation list: 1 of 2026-10-17T10:00:00Z, expired at 2027-01-15T10:00:00Z; installs and pins need a newer one',
    ),
  );
  await run('remove', 'sample');
});

test('a release that no longer trusts the key of the stored list is refused before the switch', async (t) => {
  const { root, keys, context, run } = await setup(t);
  // The release itself: its built-in keys must verify the stored list.
  await run('check-revocations');
  await assert.rejects(
    moduleCommand(['check-revocations', '--root', root], {
      ...context,
      moduleKeys: [testKey().key],
    }),
    new RegExp(`signed by key ${keys.module.id}, which this release does not trust`),
  );
  // The updater asks the staged release (the real entry, whose built-in module keys are empty).
  const staged = join(root, 'releases/9.9.9/apps/deploy/dist');
  await mkdir(staged, { recursive: true });
  const entry = pathToFileURL(join(import.meta.dirname, '../apps/deploy/dist/main.js')).href;
  await writeFile(join(staged, 'main.js'), `await import(${JSON.stringify(entry)});\n`);
  await assert.rejects(
    checkReleaseRevocationKeys(root, '9.9.9'),
    /Release 9\.9\.9 does not trust the key of the stored module revocation list/,
  );
  // A release that verifies the list, and a host without a list, pass.
  await writeFile(join(staged, 'main.js'), 'process.exitCode = 0;\n');
  await checkReleaseRevocationKeys(root, '9.9.9');
  await writeFile(join(staged, 'main.js'), 'process.exitCode = 1;\n');
  await rm(join(root, 'config/module-revocations.json'));
  await checkReleaseRevocationKeys(root, '9.9.9');
});

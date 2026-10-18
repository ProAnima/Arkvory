import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseModuleManifest } from '../packages/extension-api/dist/index.js';
import {
  ModuleLoadError,
  ModulePlanError,
  admitPackage,
  checkInstalledModules,
  installedModulesFrom,
  loadInstallation,
  parseModuleSelections,
  planInstallation,
  signedRefusals,
} from '../packages/infrastructure/dist/index.js';
import {
  modulePackage,
  moduleInstallation,
  moduleManifestOf,
  openToEveryone,
  revocationList,
  testKey,
} from './module-fixtures.mjs';

const KEY = '0123456789abcdef';
const SHA = 'a'.repeat(64);

function signedOf(overrides = {}, { dataClass = 'none', source = 'signed', keyId = KEY } = {}) {
  return {
    manifest: {
      module: parseModuleManifest(moduleManifestOf({ roles: ['api', 'reader'], ...overrides })),
      package: { side: 'server', entry: {}, dataClass, licenseFeature: null, coreRelease: null },
    },
    signer: { source, keyId, label: null, expired: false },
  };
}

const entryOf = (overrides = {}) => ({
  id: 'sample',
  version: '1.0.0',
  sha256: SHA,
  keyId: KEY,
  source: 'signed',
  dataClass: 'none',
  pinned: false,
  installedAt: '2026-10-17T12:00:00Z',
  ...overrides,
});

/** A revocation list as `readRevocations` returns it; expired long ago, which changes nothing. */
const listOf = (entries) => ({
  sequence: 3,
  issuedAt: '2025-01-01T00:00:00Z',
  expiresAt: '2025-03-01T00:00:00Z',
  entries,
  keyId: KEY,
  payload: '',
  envelope: '',
});

const verdict = (result) => ('manifest' in result ? 'loaded' : `${result.status}:${result.code}`);

test('the decision for a verified package, row by row (ADR 0078, 3.3 and 3.4)', () => {
  const revoke = (readOnly, versions = ['1.0.0']) =>
    listOf([{ id: 'sample', versions, reason: 'security_issue', readOnly, replacement: '1.0.1' }]);
  const rows = [
    ['the installed package', signedOf(), entryOf(), null, 'loaded'],
    ['another id', signedOf({ id: 'other' }), entryOf(), null, 'failed:installed_mismatch'],
    [
      'another version',
      signedOf({ version: '1.0.1' }),
      entryOf(),
      null,
      'failed:installed_mismatch',
    ],
    [
      'another key',
      signedOf(),
      entryOf({ keyId: 'f'.repeat(16) }),
      null,
      'failed:installed_mismatch',
    ],
    [
      'another data class',
      signedOf({}, { dataClass: 'layout' }),
      entryOf(),
      null,
      'failed:installed_mismatch',
    ],
    [
      'an operator key',
      signedOf({}, { source: 'operator' }),
      entryOf(),
      null,
      'failed:installed_mismatch',
    ],
    ['revoked', signedOf(), entryOf(), revoke(false), 'revoked:security_issue'],
    ['revoked with a read path', signedOf(), entryOf(), revoke(true), 'revoked:security_issue'],
    ['another version revoked', signedOf(), entryOf(), revoke(false, ['0.9.0']), 'loaded'],
    ['a stale list without its entry', signedOf(), entryOf(), listOf([]), 'loaded'],
    [
      'a worker role',
      signedOf({ roles: ['api', 'worker'] }),
      entryOf(),
      null,
      'failed:role_unsupported',
    ],
    ['a backup role', signedOf({ roles: ['backup'] }), entryOf(), null, 'failed:role_unsupported'],
    [
      'routes',
      signedOf({ routePrefixes: ['/api/ext/sample/v1/'] }),
      entryOf(),
      null,
      'failed:routes_unsupported',
    ],
  ];
  for (const [name, signed, entry, list, expected] of rows)
    assert.equal(
      verdict(admitPackage(entry, signed, list, '/modules/sample/1.0.0')),
      expected,
      name,
    );
  const refused = admitPackage(entryOf(), signedOf(), revoke(true), '/m');
  // A verified refusal names what the signature vouches for.
  assert.deepEqual(
    [refused.kind, refused.roles, refused.enabled],
    ['protocol', ['api', 'reader'], false],
  );
});

test('plan problems refuse the signed modules they name; built-in problems stay fatal', () => {
  const problems = [
    { code: 'missing_requirement', module: 'consumer', subject: 'feed' },
    { code: 'route_prefix_overlap', module: 'consumer', subject: '/x/' },
    { code: 'core_disabled', module: 'upack', subject: null },
    { code: 'invalid_manifest', module: null, subject: '/3', reason: 'type' },
  ];
  assert.deepEqual(
    [...signedRefusals(problems, new Set(['consumer']))],
    [['consumer', 'missing_requirement']],
  );
  assert.equal(signedRefusals(problems, new Set()).size, 0);
});

/** A verified module as `checkInstalledModules` returns it, without files on disk. */
function verified(id, overrides = {}, version = '1.0.0') {
  const signed = signedOf({ id, version, kind: 'event-sink', ...overrides });
  return {
    entry: entryOf({ id, version }),
    directory: `/modules/${id}/${version}`,
    manifest: signed.manifest,
  };
}

const selections = (modules) => parseModuleSelections({ format: 1, modules });

test('signed modules are planned beside the built-in ones, disabled until the operator enables them', () => {
  const installed = { verified: [verified('sample')], refused: [] };
  const off = planInstallation('1.6.0', new Map(), installed);
  const sample = off.plan.modules.find((m) => m.manifest.id === 'sample');
  assert.deepEqual([sample.source, sample.enabled, sample.packageSha256], ['signed', false, SHA]);
  assert.ok(!off.plan.startOrder.includes('sample'));
  const on = planInstallation('1.6.0', selections({ sample: { enabled: true } }), installed);
  assert.ok(on.plan.startOrder.includes('sample'));
  assert.notEqual(on.plan.compatibilityFingerprint, off.plan.compatibilityFingerprint);
  // The settings as written enter the fingerprint: every process can read them.
  const configured = planInstallation(
    '1.6.0',
    selections({ sample: { enabled: true, config: { depth: 2 } } }),
    installed,
  );
  assert.notEqual(configured.plan.compatibilityFingerprint, on.plan.compatibilityFingerprint);
  // Same line of the module's version: the processes still agree; another major does not.
  const line = (version) =>
    planInstallation('1.6.0', selections({ sample: { enabled: true } }), {
      verified: [verified('sample', {}, version)],
      refused: [],
    }).plan.compatibilityFingerprint;
  assert.equal(line('1.3.0'), on.plan.compatibilityFingerprint);
  assert.notEqual(line('2.0.0'), on.plan.compatibilityFingerprint);
  // A choice for a module that is neither built in nor installed still stops the start.
  assert.throws(
    () => planInstallation('1.6.0', selections({ absent: { enabled: true } }), installed),
    /unknown module absent/,
  );
  // A refused module is still known: choosing it is not an error, and it keeps the choice.
  const refused = {
    id: 'gone',
    version: '1.0.0',
    kind: null,
    roles: [],
    enabled: false,
    status: 'failed',
    code: 'file_mismatch',
  };
  const planned = planInstallation('1.6.0', selections({ gone: { enabled: true } }), {
    verified: [],
    refused: [refused],
  });
  assert.deepEqual(planned.refused, [{ ...refused, enabled: true }]);
});

test('a refused provider refuses its consumers in turn; a signed id of a built-in module is refused', () => {
  const installed = {
    verified: [
      verified('consumer', { requires: ['feed'], provides: ['digest'] }),
      verified('reader-of-digest', { requires: ['digest'] }),
      verified('upack'),
      verified('alone'),
    ],
    // The provider of `feed` was refused before planning.
    refused: [
      {
        id: 'feeder',
        version: '1.0.0',
        kind: null,
        roles: [],
        enabled: false,
        status: 'failed',
        code: 'unknown_key',
      },
    ],
  };
  const all = Object.fromEntries(
    ['consumer', 'reader-of-digest', 'alone', 'feeder'].map((id) => [id, { enabled: true }]),
  );
  const { plan, refused } = planInstallation('1.6.0', selections(all), installed);
  assert.deepEqual(
    refused.map((m) => [m.id, m.code, m.enabled]),
    [
      ['consumer', 'missing_requirement', true],
      ['feeder', 'unknown_key', true],
      ['reader-of-digest', 'missing_requirement', true],
      ['upack', 'duplicate_id', false],
    ],
  );
  assert.ok(plan.startOrder.includes('alone'));
  assert.equal(plan.modules.find((m) => m.manifest.id === 'upack').source, 'builtin');
  // A built-in problem is the operator's: the start stops.
  assert.throws(
    () => planInstallation('1.6.0', selections({ upack: { enabled: false } }), installed),
    (error) => error instanceof ModulePlanError && error.problems[0].code === 'core_disabled',
  );
});

const imported = () => globalThis.arkvoryImported ?? [];
const enable = (id = 'sample', config) =>
  selections({ [id]: { enabled: true, ...(config ? { config } : {}) } });

test('an installed package is verified, planned in every process and imported only where it runs', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'ledger' }));
  const options = {
    coreVersion: '0.6.0',
    selections: enable('ledger'),
    installed: host.source(),
    now: Date.now(),
  };
  const worker = await loadInstallation({ ...options, role: 'worker' });
  assert.ok(!imported().some((m) => m.startsWith('ledger@')), 'the worker never imports it');
  const api = await loadInstallation({ ...options, role: 'api' });
  assert.equal(imported().filter((m) => m === 'ledger@1.0.0').length, 1);
  assert.equal(worker.plan.compatibilityFingerprint, api.plan.compatibilityFingerprint);
  const set = JSON.parse(await readFile(join(host.modules, 'installed.json'), 'utf8'));
  const planned = api.plan.modules.find((m) => m.manifest.id === 'ledger');
  assert.deepEqual(
    [planned.source, planned.enabled, planned.packageSha256],
    ['signed', true, set.modules[0].sha256],
  );
  assert.deepEqual(api.refused, []);
  const instance = api.prepared.get('ledger').create({});
  await instance.start(new AbortController().signal);
  assert.deepEqual(instance.health(), { status: 'ok', code: null });
  // Without the directory no signed module is looked for, as before the loader.
  const none = await loadInstallation({
    ...options,
    selections: new Map(),
    installed: undefined,
    role: 'api',
  });
  assert.ok(!none.plan.modules.some((m) => m.source === 'signed'));
});

/** Loads `host` as the API process would and returns the refusal of `id`, or 'loaded'. */
async function outcome(host, id, { keys, config } = {}) {
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: enable(id, config),
    installed: host.source(keys),
    now: Date.now(),
  });
  const refused = loaded.refused.find((m) => m.id === id);
  // Which path and which rule refused it, in the test output when an assertion fails.
  if (refused?.detail) console.log(`# ${id} ${refused.code}: ${refused.detail}`);
  if (refused) return `${refused.status}:${refused.code}`;
  try {
    loaded.prepared.get(id).create({});
    return 'loaded';
  } catch (error) {
    assert.ok(error instanceof ModuleLoadError);
    return `code:${error.code}`;
  }
}

test('a file changed after installation, a revoked version and an unknown key are refused before import', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'tampered' }));
  await host.install(modulePackage(host.keys.module, { id: 'revoked' }));
  await host.install(modulePackage(host.keys.module, { id: 'foreign' }));
  await writeFile(
    join(host.modules, 'tampered/1.0.0/files/main.mjs'),
    'globalThis.pwned = true;\n',
  );
  assert.equal(await outcome(host, 'tampered'), 'failed:file_mismatch');
  assert.equal(globalThis.pwned, undefined);
  assert.ok(!imported().includes('tampered@1.0.0'));

  // A newer list revokes the version; the same list says nothing of the others.
  const list = revocationList(host.keys.module, {
    sequence: 2,
    entries: [
      {
        id: 'revoked',
        versions: ['1.0.0'],
        reason: 'unsafe_read',
        readOnly: false,
        replacement: null,
      },
    ],
  });
  await host.run('revocations', await host.writeFileIn('revocations.json', list));
  assert.equal(await outcome(host, 'revoked'), 'revoked:unsafe_read');
  assert.ok(!imported().includes('revoked@1.0.0'));
  // The release does not trust the key that signed the package (its list is signed by a key it
  // trusts): refused, never imported. With the stored list of an untrusted key nothing loads.
  const other = testKey();
  assert.equal(await outcome(host, 'foreign', { keys: [other.key] }), 'failed:revocations_invalid');
  const kept = await readFile(host.source().revocationsFile, 'utf8');
  await writeFile(
    host.source().revocationsFile,
    revocationList(other, { sequence: 9, entries: [] }),
  );
  assert.equal(await outcome(host, 'foreign', { keys: [other.key] }), 'failed:unknown_key');
  assert.ok(!imported().includes('foreign@1.0.0'));
  await writeFile(host.source().revocationsFile, kept);
  assert.equal(await outcome(host, 'foreign'), 'loaded');
});

test('a stale revocation list never stops a module; a list that no longer verifies stops all', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'steady' }));
  const stale = revocationList(host.keys.module, {
    sequence: 2,
    issuedAt: '2025-01-01T00:00:00Z',
    expiresAt: '2025-03-01T00:00:00Z',
    entries: [],
  });
  await host.run('revocations', await host.writeFileIn('stale.json', stale));
  assert.equal(await outcome(host, 'steady'), 'loaded');
  // Without any list the module loads too: only an entry of a list stops a version.
  await rm(host.source().revocationsFile);
  assert.equal(await outcome(host, 'steady'), 'loaded');
  await writeFile(host.source().revocationsFile, '{"format":1}');
  assert.equal(await outcome(host, 'steady'), 'failed:revocations_invalid');
});

test('a module of another extension API is refused as incompatible', async (t) => {
  const host = await moduleInstallation(t, { extensionApi: '9.1.0' });
  await host.install(modulePackage(host.keys.module, { id: 'future', extensionApi: '^9.0.0' }));
  assert.equal(await outcome(host, 'future'), 'failed:module_incompatible');
  assert.ok(!imported().includes('future@1.0.0'));
});

test('a package others may change, a link inside it or a missing package is refused', async (t) => {
  const host = await moduleInstallation(t);
  const ids = ['writable', 'linked', 'aliased', 'vanished', 'fine'];
  for (const id of ids) await host.install(modulePackage(host.keys.module, { id }));
  await openToEveryone(join(host.modules, 'writable/1.0.0/files/main.mjs'));
  const link = join(host.modules, 'linked/1.0.0/files/more');
  await symlink(join(host.modules, 'fine/1.0.0/files'), link, 'junction');
  // `modules/<id>` itself leading elsewhere: the tree below it is not the one checked.
  const alias = join(host.modules, 'aliased');
  await rename(alias, join(host.modules, '.aliased'));
  await symlink(join(host.modules, '.aliased'), alias, 'junction');
  await rm(join(host.modules, 'vanished/1.0.0'), { recursive: true });
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: selections(Object.fromEntries(ids.map((id) => [id, { enabled: true }]))),
    installed: host.source(),
    now: Date.now(),
  });
  // Unlinked at once: a recursive removal through a junction can fail on Windows.
  await unlink(link);
  await unlink(alias);
  assert.deepEqual(
    loaded.refused.map((m) => [m.id, m.status, m.code]),
    [
      ['aliased', 'failed', 'access_link'],
      ['linked', 'failed', 'access_link'],
      ['vanished', 'unavailable', 'module_unavailable'],
      ['writable', 'failed', 'access_unsafe'],
    ],
  );
  assert.ok(!imported().includes('writable@1.0.0'));
  assert.ok(loaded.plan.startOrder.includes('fine'));
  // The set file itself open to others: no module is trusted.
  await openToEveryone(join(host.modules, 'installed.json'));
  assert.equal(await outcome(host, 'fine'), 'failed:access_unsafe');
});

test('code that fails to load, describes another module or refuses its settings fails alone', async (t) => {
  const host = await moduleInstallation(t);
  const { module } = host.keys;
  await host.install(modulePackage(module, { id: 'throws' }, { throwOnImport: true }));
  await host.install(
    modulePackage(
      module,
      { id: 'impostor' },
      { manifest: moduleManifestOf({ id: 'impostor', version: '9.9.9' }) },
    ),
  );
  await host.install(modulePackage(module, { id: 'picky' }, { requireConfig: true }));
  assert.equal(await outcome(host, 'throws'), 'code:import_failed');
  assert.equal(await outcome(host, 'impostor'), 'code:descriptor_mismatch');
  assert.equal(await outcome(host, 'picky'), 'code:config_invalid');
  assert.equal(await outcome(host, 'picky', { config: { mode: 'on' } }), 'loaded');
});

test('a package named like a built-in module never replaces it and is never imported', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'upack' }));
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: new Map(),
    installed: host.source(),
    now: Date.now(),
  });
  assert.deepEqual(
    loaded.refused.map((m) => [m.id, m.code]),
    [['upack', 'duplicate_id']],
  );
  assert.equal(loaded.plan.modules.find((m) => m.manifest.id === 'upack').source, 'builtin');
  assert.equal(loaded.prepared.get('upack').candidate.source, 'builtin');
  loaded.prepared.get('upack').create({});
  assert.ok(!imported().includes('upack@1.0.0'));
});

test('the set file and the environment are read strictly', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'sample' }));
  await writeFile(join(host.modules, 'installed.json'), '{"format":2}');
  await assert.rejects(
    checkInstalledModules(host.source(), { coreVersion: '0.6.0', extensionApi: '0.2.0', now: 0 }),
    /Invalid modules\/installed\.json/,
  );
  assert.equal(installedModulesFrom({}), undefined);
  assert.throws(() => installedModulesFrom({ ARKVORY_MODULES_DIR: 'modules' }), /absolute/);
  const source = installedModulesFrom({ ARKVORY_MODULES_DIR: host.modules });
  assert.equal(source.revocationsFile, join(host.root, 'config', 'module-revocations.json'));
  // The services always trust the module keys of the release, never keys from configuration.
  assert.ok(source.keys.length > 0 && source.keys.every((key) => /^[0-9a-f]{16}$/.test(key.id)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EXTENSION_API_VERSION,
  ModuleManifestError,
  capabilityName,
  defineCapability,
  parseModuleManifest,
  planModules,
} from '../packages/extension-api/dist/index.js';

// Versioned capability values between modules (ADR 0083, N13): manifest, plan and fingerprints.
const manifest = (id, extra = {}) => ({
  format: 1,
  id,
  version: '1.0.0',
  extensionApi: `^${EXTENSION_API_VERSION}`,
  kind: 'protocol',
  publisher: 'proanimastudio',
  core: false,
  roles: ['api'],
  requires: [],
  provides: [],
  routePrefixes: [],
  metricPrefix: null,
  tablePrefix: null,
  ...extra,
});
const signed = { source: 'signed', packageSha256: 'a'.repeat(64) };
const operator = { source: 'operator', packageSha256: 'b'.repeat(64) };
const candidate = (id, extra = {}, options = signed) => ({
  manifest: manifest(id, extra),
  source: 'builtin',
  packageSha256: null,
  enabled: true,
  config: {},
  ...options,
});
const host = {
  coreVersion: '1.4.0',
  extensionApi: EXTENSION_API_VERSION,
  reservedRoutePrefixes: ['/api/v1/'],
  sha256: (text) => createHash('sha256').update(text).digest('hex'),
  services: [],
};
const plan = (candidates) => {
  const result = planModules(candidates, host);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  return result.plan;
};
const problems = (candidates) => {
  const result = planModules(candidates, host);
  assert.equal(result.ok, false, 'the plan must be refused');
  return result.problems.map(({ code, module, subject }) => [code, module, subject]);
};
const refused = (input, code, path) =>
  assert.throws(
    () => parseModuleManifest(input),
    (error) => error instanceof ModuleManifestError && error.code === code && error.path === path,
    `${code} at ${path}`,
  );

test('capability entries carry a version; the manifest refuses malformed and doubled names', () => {
  const read = parseModuleManifest(
    manifest('index', {
      provides: ['index@1.4.0'],
      requires: ['keys@^1.2.0'],
      optional: ['cache@^0.3.0'],
      exposeTo: ['builtin', 'operator'],
      resources: { dataMiB: 512, dataFiles: 10000 },
    }),
  );
  assert.deepEqual(read.provides, ['index@1.4.0']);
  assert.deepEqual(read.optional, ['cache@^0.3.0']);
  assert.deepEqual(read.exposeTo, ['builtin', 'operator']);
  assert.deepEqual(read.resources, { dataMiB: 512, dataFiles: 10000 });
  refused(manifest('index', { provides: ['index@^1.0.0'] }), 'format', '/provides/0');
  refused(manifest('index', { provides: ['index@1.0.0-rc.1'] }), 'format', '/provides/0');
  refused(manifest('index', { requires: ['keys@1.0.0'] }), 'format', '/requires/0');
  refused(manifest('index', { requires: ['Keys@^1.0.0'] }), 'format', '/requires/0');
  refused(manifest('index', { provides: ['a@1.0.0', 'a@2.0.0'] }), 'duplicate', '/provides/1');
  refused(
    manifest('index', { requires: ['a@^1.0.0'], optional: ['a@^1.0.0'] }),
    'duplicate',
    '/optional/0',
  );
  refused(manifest('index', { exposeTo: ['everyone'] }), 'format', '/exposeTo/0');
  refused(manifest('index', { resources: { dataMiB: 1 } }), 'required', '/resources/dataFiles');
  refused(
    manifest('index', { resources: { dataMiB: -1, dataFiles: 1 } }),
    'format',
    '/resources/dataMiB',
  );
  refused(
    manifest('index', { resources: { dataMiB: 1, dataFiles: 1, inodes: 1 } }),
    'unknown_field',
    '/resources/inodes',
  );
  assert.equal(capabilityName('keys@^1.2.0'), 'keys');
  assert.equal(capabilityName('keys'), 'keys');
});

test('a requirement matches the provider by caret range, else the plan is refused', () => {
  const provider = candidate('keys', { provides: ['keys@1.4.0'] });
  plan([provider, candidate('user', { requires: ['keys@^1.2.0'] })]);
  assert.deepEqual(problems([provider, candidate('user', { requires: ['keys@^1.5.0'] })]), [
    ['requirement_version_mismatch', 'user', 'keys'],
  ]);
  assert.deepEqual(problems([provider, candidate('user', { requires: ['keys@^2.0.0'] })]), [
    ['requirement_version_mismatch', 'user', 'keys'],
  ]);
  // Below 1.0.0 the minor version is the contract.
  const early = candidate('keys', { provides: ['keys@0.3.1'] });
  plan([early, candidate('user', { requires: ['keys@^0.3.0'] })]);
  assert.deepEqual(problems([early, candidate('user', { requires: ['keys@^0.2.0'] })]), [
    ['requirement_version_mismatch', 'user', 'keys'],
  ]);
});

test('only built-in modules name capabilities without a version', () => {
  const builtin = { source: 'builtin', packageSha256: null };
  plan([
    candidate('keys', { provides: ['keys'] }, builtin),
    candidate('user', { requires: ['keys'] }, builtin),
  ]);
  assert.deepEqual(
    problems([
      candidate('keys', { provides: ['keys'] }),
      candidate('user', { requires: ['keys@^0.0.0'] }),
    ]),
    [['capability_unversioned', 'keys', 'keys']],
  );
  // A version-less built-in provider is 0.0.0 for a versioned consumer.
  plan([
    candidate('keys', { provides: ['keys'] }, builtin),
    candidate('user', { requires: ['keys@^0.0.0'] }),
  ]);
});

test('a value is open to the same publisher, and to other sources only through exposeTo', () => {
  const provider = (extra = {}) => candidate('keys', { provides: ['keys@1.0.0'], ...extra });
  const plugin = candidate(
    'op-user',
    { requires: ['keys@^1.0.0'], publisher: 'acme', roles: ['api'] },
    operator,
  );
  assert.deepEqual(problems([provider(), plugin]), [['capability_not_exposed', 'op-user', 'keys']]);
  plan([provider({ exposeTo: ['operator'] }), plugin]);
  // Another publisher's signed module is not the same publisher either.
  const foreign = candidate('user', { requires: ['keys@^1.0.0'], publisher: 'acme' });
  assert.deepEqual(problems([provider(), foreign]), [['capability_not_exposed', 'user', 'keys']]);
  plan([provider({ exposeTo: ['signed'] }), foreign]);
});

test('an optional capability without a provider passes; with one it is checked and ordered', () => {
  const user = candidate('user', { optional: ['cache@^1.0.0'] });
  assert.deepEqual(plan([user]).startOrder, ['user']);
  const cache = candidate('zcache', { provides: ['cache@1.2.0'], roles: ['worker'] });
  // The provider starts first; it may run in other processes only.
  assert.deepEqual(plan([user, cache]).startOrder, ['zcache', 'user']);
  const old = candidate('zcache', { provides: ['cache@2.0.0'] });
  assert.deepEqual(problems([user, old]), [['requirement_version_mismatch', 'user', 'cache']]);
  // A required one must run in every process of the consumer.
  const strict = candidate('user', { requires: ['cache@^1.0.0'] });
  assert.deepEqual(problems([strict, cache]), [['requirement_role_mismatch', 'user', 'cache']]);
});

test('capability versions enter the fingerprints, along their line in the compatible one', () => {
  const at = (version, range = '^1.0.0') =>
    plan([
      candidate('keys', { provides: [`keys@${version}`] }),
      candidate('user', { requires: [`keys@${range}`] }),
    ]);
  assert.equal(at('1.0.0').compatibilityFingerprint, at('1.4.2').compatibilityFingerprint);
  assert.notEqual(at('1.0.0').fingerprint, at('1.4.2').fingerprint);
  assert.notEqual(
    at('1.0.0').compatibilityFingerprint,
    at('2.0.0', '^2.0.0').compatibilityFingerprint,
  );
  // A plan without capabilities keeps the digest it had before capabilities had versions.
  const bare = plan([candidate('npm', {}, { source: 'builtin', packageSha256: null })]);
  const expected = createHash('sha256')
    .update(
      JSON.stringify({
        format: 1,
        modules: [
          {
            config: {},
            enabled: true,
            id: 'npm',
            kind: 'protocol',
            line: null,
            source: 'builtin',
          },
        ],
        scope: 'compatibility',
      }),
    )
    .digest('hex');
  assert.equal(bare.compatibilityFingerprint, expected);
});

test('defineCapability builds a frozen token and refuses malformed names and versions', () => {
  const isCounter = (value) => typeof value === 'object' && value !== null && 'next' in value;
  const token = defineCapability('counter', '1.2.0', isCounter);
  assert.equal(Object.isFrozen(token), true);
  assert.equal(token.check({ next: () => 1 }), true);
  assert.throws(() => defineCapability('Counter', '1.0.0', isCounter), TypeError);
  assert.throws(() => defineCapability('counter', '^1.0.0', isCounter), TypeError);
  assert.throws(() => defineCapability('counter', '1.0.0-rc.1', isCounter), TypeError);
});

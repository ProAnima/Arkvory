import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EXTENSION_API_VERSION,
  HOST_SERVICES,
  MODULE_SOURCES,
  ModuleManifestError,
  canonicalJson,
  parseCaretRange,
  parseModuleManifest,
  parseSemanticVersion,
  planModules,
  satisfiesCaret,
} from '../packages/extension-api/dist/index.js';

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
const candidate = (id, extra = {}, options = {}) => ({
  manifest: manifest(id, extra),
  source: 'builtin',
  packageSha256: null,
  enabled: true,
  config: {},
  ...options,
});
const signed = { source: 'signed', packageSha256: 'a'.repeat(64) };
const host = {
  coreVersion: '1.4.0',
  extensionApi: EXTENSION_API_VERSION,
  reservedRoutePrefixes: ['/api/v1/', '/health/', '/console/'],
  sha256: (text) => createHash('sha256').update(text).digest('hex'),
  services: [],
};
const plan = (candidates, at = host) => {
  const result = planModules(candidates, at);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  return result.plan;
};
const problems = (candidates, at = host) => {
  const result = planModules(candidates, at);
  assert.equal(result.ok, false, 'the plan must be refused');
  return result.problems.map(({ code, module, subject }) => [code, module, subject]);
};
const refused = (input, code, path) =>
  assert.throws(
    () => parseModuleManifest(input),
    (error) => error instanceof ModuleManifestError && error.code === code && error.path === path,
    `${code} at ${path}`,
  );

test('a manifest is read from untrusted input field by field, naming the field, never the value', () => {
  assert.deepEqual(parseModuleManifest(manifest('npm')), {
    ...manifest('npm'),
    uses: [],
    optional: [],
    exposeTo: [],
    resources: null,
  });
  refused(null, 'type', '');
  refused([], 'type', '');
  refused({ ...manifest('npm'), entry: 'x.js' }, 'unknown_field', '/entry');
  const { roles: _roles, ...noRoles } = manifest('npm');
  refused(noRoles, 'required', '/roles');
  refused(manifest('npm', { format: 2 }), 'unsupported_format', '/format');
  // A later format may add or drop fields: it is unsupported, not malformed.
  refused({ ...manifest('npm'), format: 2, dataClass: 'layout' }, 'unsupported_format', '/format');
  refused({ format: 2 }, 'unsupported_format', '/format');
  refused(manifest('npm', { format: '1' }), 'type', '/format');
  refused(manifest('npm', { core: 'yes' }), 'type', '/core');
  refused(manifest('n'), 'format', '/id');
  refused(manifest('Npm'), 'format', '/id');
  // A doubled or trailing hyphen would make the names of two modules ambiguous.
  refused(manifest('foo--bar'), 'format', '/id');
  refused(manifest('foo-'), 'format', '/id');
  refused(manifest('-foo'), 'format', '/id');
  refused(manifest(`a${'b'.repeat(32)}`), 'format', '/id');
  parseModuleManifest(manifest(`a${'b-c'.repeat(10)}b`));
  refused(manifest('npm', { version: '1.0' }), 'format', '/version');
  refused(manifest('npm', { extensionApi: '>=0.1.0' }), 'format', '/extensionApi');
  refused(manifest('npm', { extensionApi: '^0.1.0-beta' }), 'format', '/extensionApi');
  refused(manifest('npm', { kind: 'Plugin' }), 'format', '/kind');
  refused(manifest('npm', { kind: 'p' }), 'format', '/kind');
  // A later contract may name an extension point this one does not know: still readable.
  assert.equal(parseModuleManifest(manifest('npm', { kind: 'search' })).kind, 'search');
  const { publisher: _publisher, ...anonymous } = manifest('npm');
  refused(anonymous, 'required', '/publisher');
  refused(manifest('npm', { publisher: 'ProAnima' }), 'format', '/publisher');
  refused(manifest('npm', { publisher: 7 }), 'type', '/publisher');
  const uses = ['routes', 'catalog-read'];
  assert.deepEqual(parseModuleManifest(manifest('npm', { uses })).uses, uses);
  refused(manifest('npm', { uses: 'routes' }), 'type', '/uses');
  refused(manifest('npm', { uses: ['routes', 'routes'] }), 'duplicate', '/uses/1');
  refused(manifest('npm', { uses: ['Routes'] }), 'format', '/uses/0');
  refused(manifest('npm', { roles: [] }), 'format', '/roles');
  refused(manifest('npm', { roles: ['api', 'api'] }), 'duplicate', '/roles/1');
  refused(manifest('npm', { roles: ['web'] }), 'format', '/roles/0');
  refused(manifest('npm', { requires: [7] }), 'type', '/requires/0');
  refused(manifest('npm', { routePrefixes: ['/npm'] }), 'format', '/routePrefixes/0');
  refused(manifest('npm', { routePrefixes: ['/../'] }), 'format', '/routePrefixes/0');
  refused(manifest('npm', { routePrefixes: ['/npm/:id/'] }), 'format', '/routePrefixes/0');
  refused(manifest('npm', { metricPrefix: 'npm_' }), 'format', '/metricPrefix');
  refused(manifest('npm', { tablePrefix: 'arkvory_npm' }), 'format', '/tablePrefix');
  const secret = 'Do-Not-Echo-This-Value';
  assert.throws(
    () => parseModuleManifest(manifest(secret)),
    (error) => !error.message.includes(secret) && error.message.includes('/id'),
  );
});

test('versions follow semver and caret ranges as npm reads them', () => {
  assert.deepEqual(parseSemanticVersion('1.2.3-rc.1'), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: 'rc.1',
  });
  for (const text of [
    '01.2.3',
    '1.2',
    '1.2.3+build',
    'v1.2.3',
    '1.2.3-',
    '9999999999.0.0',
    '1.2.3-01',
    '1.2.3-rc.01',
    '1.2.3-rc..1',
  ])
    assert.equal(parseSemanticVersion(text), null, text);
  for (const text of ['1.2.3-0', '1.2.3-0a', '1.2.3-rc.10', '1.2.3-x-1'])
    assert.notEqual(parseSemanticVersion(text), null, text);
  assert.equal(parseCaretRange('1.2.3'), null);
  const satisfied = (range, version) =>
    satisfiesCaret(parseCaretRange(range), parseSemanticVersion(version));
  for (const [range, version, expected] of [
    ['^1.2.3', '1.2.3', true],
    ['^1.2.3', '1.9.0', true],
    ['^1.2.3', '1.2.2', false],
    ['^1.2.3', '2.0.0', false],
    ['^0.1.0', '0.1.7', true],
    ['^0.1.2', '0.1.1', false],
    ['^0.1.0', '0.2.0', false],
    ['^0.0.3', '0.0.3', true],
    ['^0.0.3', '0.0.4', false],
    ['^1.0.0', '1.1.0-rc.1', false],
  ])
    assert.equal(satisfied(range, version), expected, `${version} in ${range}`);
});

test('a plan refuses unreadable manifests and duplicate ids before any other rule', () => {
  assert.deepEqual(
    planModules([candidate('npm'), candidate('oci', { kind: 'Plugin' })], host).problems,
    [{ code: 'invalid_manifest', module: null, subject: '/1/kind', reason: 'format' }],
  );
  assert.deepEqual(problems([candidate('npm'), candidate('npm', { core: true })]), [
    ['duplicate_id', 'npm', null],
  ]);
});

test('a manifest written for another extension API is incompatible, not malformed', () => {
  // A later contract may add fields and extension points this core cannot read.
  const later = {
    ...manifest('next', { extensionApi: '^0.10.0', kind: 'search' }),
    dataClass: 'x',
  };
  assert.deepEqual(problems([candidate('npm'), { ...candidate('next'), manifest: later }]), [
    ['incompatible_api', 'next', '^0.10.0'],
  ]);
  // Without a readable id or range there is nothing to name: the manifest is malformed.
  const nameless = manifest('Next', { extensionApi: '^0.10.0' });
  assert.deepEqual(planModules([{ ...candidate('next'), manifest: nameless }], host).problems, [
    { code: 'invalid_manifest', module: null, subject: '/0/id', reason: 'format' },
  ]);
  const compatible = { ...later, extensionApi: `^${EXTENSION_API_VERSION}` };
  assert.deepEqual(planModules([{ ...candidate('next'), manifest: compatible }], host).problems, [
    { code: 'invalid_manifest', module: null, subject: '/0/dataClass', reason: 'unknown_field' },
  ]);
});

test('core modules are built in and enabled; every module matches the extension API', () => {
  assert.deepEqual(problems([candidate('upack', { core: true }, { enabled: false })]), [
    ['core_disabled', 'upack', null],
  ]);
  assert.deepEqual(problems([candidate('upack', { core: true }, signed)]), [
    ['core_not_builtin', 'upack', null],
  ]);
  assert.deepEqual(problems([candidate('next', { extensionApi: '^1.0.0' })]), [
    ['incompatible_api', 'next', '^1.0.0'],
  ]);
  assert.deepEqual(problems([candidate('newer', { extensionApi: '^0.10.0' })]), [
    ['incompatible_api', 'newer', '^0.10.0'],
  ]);
  // A manifest of the previous contract lacks fields this one requires: incompatible.
  const { publisher: _publisher, ...previous } = manifest('old', { extensionApi: '^0.1.0' });
  assert.deepEqual(problems([{ ...candidate('old'), manifest: previous }]), [
    ['incompatible_api', 'old', '^0.1.0'],
  ]);
  // Even a disabled module must be readable by this core: its migrations and data stay known.
  assert.deepEqual(problems([candidate('old', { extensionApi: '^9.0.0' }, { enabled: false })]), [
    ['incompatible_api', 'old', '^9.0.0'],
  ]);
  assert.deepEqual(problems([candidate('ext', {}, { source: 'signed', packageSha256: 'A1' })]), [
    ['invalid_package', 'ext', null],
  ]);
  assert.deepEqual(problems([candidate('own', {}, { packageSha256: 'a'.repeat(64) })]), [
    ['invalid_package', 'own', null],
  ]);
});

test('the 0.8 manifest shape remains usable in 0.9 with an explicitly updated API range', () => {
  // Additive shapes do not widen pre-1.0 caret ranges implicitly.
  const previous = candidate(
    'legacy-reader',
    { extensionApi: '^0.8.0', roles: ['api', 'reader'], uses: ['catalog-read', 'content-read'] },
    signed,
  );
  const currentHost = { ...host, extensionApi: '0.9.0', services: HOST_SERVICES };
  assert.deepEqual(problems([previous], currentHost), [
    ['incompatible_api', 'legacy-reader', '^0.8.0'],
  ]);
  const updated = { ...previous, manifest: { ...previous.manifest, extensionApi: '^0.9.0' } };
  const before = plan([previous], { ...currentHost, extensionApi: '0.8.0' });
  const after = plan([updated], currentHost);
  assert.deepEqual(after.startOrder, before.startOrder);
  assert.deepEqual(after.stopOrder, before.stopOrder);
  assert.deepEqual(
    after.modules,
    before.modules.map((module) => ({
      ...module,
      manifest: { ...module.manifest, extensionApi: '^0.9.0' },
    })),
  );
});

test('requirements are closed by enabled providers that run wherever their consumers run', () => {
  const store = (extra = {}, options = {}) =>
    candidate('store', { kind: 'storage-backend', provides: ['storage'], ...extra }, options);
  const user = (extra = {}) => candidate('user', { requires: ['storage'], ...extra });
  assert.deepEqual(problems([user()]), [['missing_requirement', 'user', 'storage']]);
  assert.deepEqual(problems([store({}, { enabled: false }), user()]), [
    ['missing_requirement', 'user', 'storage'],
  ]);
  // A disabled consumer needs nothing.
  plan([candidate('user', { requires: ['storage'] }, { enabled: false })]);
  assert.deepEqual(problems([store({ roles: ['api'] }), user({ roles: ['api', 'worker'] })]), [
    ['requirement_role_mismatch', 'user', 'storage'],
  ]);
  assert.deepEqual(problems([store(), candidate('twin', { provides: ['storage'] })]), [
    ['duplicate_provider', 'twin', 'storage'],
  ]);
  assert.deepEqual(
    problems([
      candidate('a-mod', { requires: ['b'], provides: ['a'] }),
      candidate('b-mod', { requires: ['a'], provides: ['b'] }),
      candidate('c-mod'),
      // Waits behind the cycle but is not on it: not named.
      candidate('d-mod', { requires: ['a'] }),
    ]),
    [
      ['requirement_cycle', 'a-mod', null],
      ['requirement_cycle', 'b-mod', null],
    ],
  );
});

test('route, metric and table prefixes never overlap', () => {
  assert.deepEqual(
    problems([
      candidate('lfs', { routePrefixes: ['/lfs/'] }),
      candidate('lfs-extra', { routePrefixes: ['/lfs/extra/'] }),
    ]),
    [['route_prefix_overlap', 'lfs-extra', '/lfs/']],
  );
  assert.deepEqual(problems([candidate('rogue', { routePrefixes: ['/health/extra/'] })]), [
    ['route_prefix_overlap', 'rogue', '/health/'],
  ]);
  // A disabled module registers no routes and publishes no metrics.
  plan([
    candidate('lfs', { routePrefixes: ['/lfs/'], metricPrefix: 'arkvory_lfs_' }),
    candidate(
      'old-lfs',
      { routePrefixes: ['/lfs/'], metricPrefix: 'arkvory_lfs_' },
      {
        enabled: false,
      },
    ),
  ]);
  assert.deepEqual(
    problems([
      candidate('oci', { metricPrefix: 'arkvory_oci_' }),
      candidate('oci-plus', { metricPrefix: 'arkvory_oci_plus_' }),
    ]),
    [['metric_prefix_overlap', 'oci-plus', 'arkvory_oci_']],
  );
  // Built-in migrations run whether a module is enabled or not: tables always count.
  assert.deepEqual(
    problems([
      candidate('npm', { tablePrefix: 'arkvory_npm_' }),
      candidate('npm-old', { tablePrefix: 'arkvory_npm_' }, { enabled: false }),
    ]),
    [['table_prefix_overlap', 'npm-old', 'arkvory_npm_']],
  );
});

test('signed modules stay in their own namespaces; built-in modules stay out of them', () => {
  plan([
    candidate(
      'delta',
      {
        version: '2.1.0',
        kind: 'transfer',
        routePrefixes: ['/api/ext/delta/v2/'],
        metricPrefix: 'arkvory_x_delta__',
        tablePrefix: 'arkvory_x_delta__',
      },
      signed,
    ),
  ]);
  assert.deepEqual(
    problems([
      candidate(
        'delta',
        {
          routePrefixes: ['/api/ext/delta/v2/', '/v3/'],
          metricPrefix: 'arkvory_delta_',
          tablePrefix: 'arkvory_x_other_',
        },
        signed,
      ),
    ]),
    [
      ['route_prefix_not_owned', 'delta', '/api/ext/delta/v2/'],
      ['route_prefix_not_owned', 'delta', '/v3/'],
      ['metric_prefix_not_owned', 'delta', 'arkvory_delta_'],
      ['table_prefix_not_owned', 'delta', 'arkvory_x_other_'],
    ],
  );
  // The double `_` ends the id: `foo` and `foo-bar` both fit, and neither name starts the other.
  const names = (id) => ({ metricPrefix: `arkvory_x_${id}__`, tablePrefix: `arkvory_x_${id}__` });
  plan([
    candidate('foo', names('foo'), signed),
    candidate('foo-bar', names('foo_bar'), signed),
    candidate('foo1', names('foo1'), signed),
  ]);
  assert.deepEqual(
    problems([candidate('two-words', { tablePrefix: 'arkvory_x_two_words_' }, signed)]),
    [['table_prefix_not_owned', 'two-words', 'arkvory_x_two_words_']],
  );
  assert.deepEqual(
    problems([
      candidate('own', {
        routePrefixes: ['/api/ext/own/v1/'],
        tablePrefix: 'arkvory_x_own_',
      }),
    ]),
    [
      ['route_prefix_not_owned', 'own', '/api/ext/own/v1/'],
      ['table_prefix_not_owned', 'own', 'arkvory_x_own_'],
    ],
  );
});

test('modules start providers first, ties by id, and stop in reverse', () => {
  const result = plan([
    candidate('zeta', { requires: ['storage'] }),
    candidate('alpha'),
    candidate('store', { provides: ['storage'], requires: ['keys'] }),
    candidate('keys', { provides: ['keys'] }),
    candidate('off', {}, { enabled: false }),
  ]);
  assert.deepEqual(result.startOrder, ['alpha', 'keys', 'store', 'zeta']);
  assert.deepEqual(result.stopOrder, ['zeta', 'store', 'keys', 'alpha']);
  assert.deepEqual(
    result.modules.map((m) => [m.manifest.id, m.enabled]),
    [
      ['alpha', true],
      ['keys', true],
      ['off', false],
      ['store', true],
      ['zeta', true],
    ],
  );
  assert.equal(result.coreVersion, '1.4.0');
  assert.equal(result.extensionApi, EXTENSION_API_VERSION);
});

test('the fingerprint is stable for equal plans and changes with anything that matters', () => {
  const base = [
    candidate('npm', {}, { config: { b: [1, { y: true, x: null }], a: 'x' } }),
    candidate('oci'),
  ];
  const fingerprint = plan(base).fingerprint;
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  const reordered = [
    candidate('oci'),
    candidate('npm', {}, { config: { a: 'x', b: [1, { x: null, y: true }] } }),
  ];
  assert.equal(plan(reordered).fingerprint, fingerprint, 'order and key order do not matter');
  const changed = [
    [candidate('npm', {}, { config: { a: 'y', b: [1, { x: null, y: true }] } }), candidate('oci')],
    [base[0], candidate('oci', {}, { enabled: false })],
    [base[0], candidate('oci', { version: '1.0.1' })],
    [base[0], candidate('oci', {}, signed)],
    [base[0]],
  ];
  for (const candidates of changed) assert.notEqual(plan(candidates).fingerprint, fingerprint);
  assert.notEqual(plan(base, { ...host, coreVersion: '1.4.1' }).fingerprint, fingerprint);
  assert.throws(() => planModules(base, { ...host, sha256: () => 'not-a-digest' }), TypeError);
  assert.throws(() => planModules(base, { ...host, extensionApi: 'one' }), TypeError);
});

test('the compatibility fingerprint leaves out the versions of the core and of built-in modules', () => {
  const base = [candidate('npm', {}, { config: { a: 'x' } }), candidate('oci')];
  const before = plan(base);
  assert.match(before.compatibilityFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(before.compatibilityFingerprint, before.fingerprint, 'two different digests');
  const reordered = [candidate('oci'), candidate('npm', {}, { config: { a: 'x' } })];
  assert.equal(plan(reordered).compatibilityFingerprint, before.compatibilityFingerprint);
  // An update of the core without a migration: built-in modules carry the new release version.
  const updated = plan(
    base.map((c) => ({ ...c, manifest: { ...c.manifest, version: '1.4.1' } })),
    { ...host, coreVersion: '1.4.1' },
  );
  assert.equal(updated.compatibilityFingerprint, before.compatibilityFingerprint);
  assert.notEqual(updated.fingerprint, before.fingerprint, 'the full fingerprint names the build');
  // What the processes must agree on changes both.
  const changed = [
    [candidate('npm', {}, { config: { a: 'y' } }), base[1]],
    [base[0], candidate('oci', {}, { enabled: false })],
    [base[0], candidate('oci', {}, signed)],
    [base[0], candidate('oci', { kind: 'event-sink' })],
    [base[0]],
  ];
  for (const candidates of changed) {
    const other = plan(candidates);
    assert.notEqual(other.compatibilityFingerprint, before.compatibilityFingerprint);
    assert.notEqual(other.fingerprint, before.fingerprint);
  }
});

test('a module that is not built in keeps its compatibility fingerprint along its caret line', () => {
  const at = (version) => plan([candidate('oci', { version }, signed)]);
  const line = (version) => at(version).compatibilityFingerprint;
  assert.equal(line('1.0.0'), line('1.4.2'), 'one major version');
  assert.notEqual(at('1.0.0').fingerprint, at('1.4.2').fingerprint);
  assert.notEqual(line('1.4.2'), line('2.0.0'));
  assert.equal(line('0.3.0'), line('0.3.9'), 'below 1.0.0 the minor version is the line');
  assert.notEqual(line('0.3.0'), line('0.4.0'));
  assert.notEqual(line('0.0.1'), line('0.0.2'), 'at 0.0.z every patch is its own line');
  const hashed = (sha) => plan([candidate('oci', {}, { ...signed, packageSha256: sha })]);
  assert.equal(
    hashed('b'.repeat(64)).compatibilityFingerprint,
    hashed('c'.repeat(64)).compatibilityFingerprint,
    'another package of the same line',
  );
});

test('canonical JSON sorts keys at every depth and refuses numbers JSON cannot carry', () => {
  assert.equal(
    canonicalJson({ b: 1, a: [{ d: 'x', c: null }, false] }),
    '{"a":[{"c":null,"d":"x"},false],"b":1}',
  );
  assert.throws(() => canonicalJson({ a: Number.NaN }), RangeError);
  assert.throws(() => canonicalJson([Number.POSITIVE_INFINITY]), RangeError);
});

test('sources and host services are published as lists of known values', () => {
  assert.deepEqual(MODULE_SOURCES, ['builtin', 'signed', 'operator', 'development']);
  assert.deepEqual(HOST_SERVICES, [
    'blob-store',
    'staged-completion',
    'catalog-read',
    'content-read',
    'upload-read',
    'change-feed',
    'data-directory',
    'derived-cache',
    'routes',
    'compute',
    'license',
  ]);
});

test('an unknown extension point stops only an enabled module', () => {
  assert.deepEqual(problems([candidate('search', { kind: 'search' })]), [
    ['unknown_kind', 'search', 'search'],
  ]);
  // A module of a later extension point stays in the plan, disabled, until a core knows it.
  const result = plan([candidate('search', { kind: 'search' }, { enabled: false })]);
  assert.deepEqual(result.startOrder, []);
  assert.equal(result.modules[0].manifest.kind, 'search');
});

test('ids of operator and development plugins start with op-, every other id never does', () => {
  const operator = { source: 'operator', packageSha256: 'b'.repeat(64) };
  const development = { source: 'development', packageSha256: 'c'.repeat(64) };
  plan([candidate('op-tool', {}, operator), candidate('op-probe', {}, development)]);
  plan([candidate(`op-a${'b'.repeat(20)}`, {}, operator)]);
  assert.deepEqual(
    problems([
      candidate('op-tool'),
      candidate('op-signed', {}, signed),
      candidate('tool', {}, operator),
      candidate('probe', {}, development),
      candidate(`op-a${'b'.repeat(21)}`, {}, operator),
    ]),
    [
      ['id_namespace_mismatch', `op-a${'b'.repeat(21)}`, null],
      ['id_namespace_mismatch', 'op-signed', null],
      ['id_namespace_mismatch', 'op-tool', null],
      ['id_namespace_mismatch', 'probe', null],
      ['id_namespace_mismatch', 'tool', null],
    ],
  );
  // Plugins keep the namespaces of external modules: `op-tool` names `arkvory_x_op_tool__`.
  plan([
    candidate(
      'op-tool',
      {
        routePrefixes: ['/api/ext/op-tool/v1/'],
        metricPrefix: 'arkvory_x_op_tool__',
        tablePrefix: 'arkvory_x_op_tool__',
      },
      operator,
    ),
  ]);
  const unpackaged = { source: 'operator', packageSha256: null };
  assert.deepEqual(problems([candidate('op-tool', {}, unpackaged)]), [
    ['invalid_package', 'op-tool', null],
  ]);
});

test('table prefixes leave PostgreSQL room for every name of the table', () => {
  const builtin = (length) => `arkvory_${'t'.repeat(length - 9)}_`;
  plan([candidate('wide', { tablePrefix: builtin(36) })]);
  assert.deepEqual(problems([candidate('wide', { tablePrefix: builtin(37) })]), [
    ['table_prefix_too_long', 'wide', builtin(37)],
  ]);
  // arkvory_x_<id>__ fits 36 characters with an id of at most 24.
  const id = (length) => `a${'b'.repeat(length - 1)}`;
  const names = (moduleId) => ({ tablePrefix: `arkvory_x_${moduleId}__` });
  plan([candidate(id(24), names(id(24)), signed)]);
  assert.deepEqual(problems([candidate(id(25), names(id(25)), signed)]), [
    ['table_prefix_too_long', id(25), `arkvory_x_${id(25)}__`],
  ]);
  // A module without tables may use the whole id length.
  plan([candidate(id(32), {}, signed)]);
});

test('a module uses only services this host provides, in its processes and for its source', () => {
  const every = { ...host, services: [...HOST_SERVICES] };
  const operator = { source: 'operator', packageSha256: 'b'.repeat(64) };
  plan([candidate('router', { roles: ['api', 'reader'], uses: ['routes'] })], every);
  plan([candidate('feed', { roles: ['worker'], uses: ['change-feed', 'catalog-read'] })], every);
  plan([candidate('op-reader', { uses: ['catalog-read', 'content-read'] }, operator)], every);
  assert.deepEqual(
    problems(
      [
        candidate('router', { roles: ['worker'], uses: ['routes'] }),
        candidate('teleport', { uses: ['teleport'] }),
        candidate('op-licensed', { uses: ['license', 'blob-store'] }, operator),
      ],
      every,
    ),
    [
      ['service_unavailable', 'op-licensed', 'license'],
      ['service_unavailable', 'op-licensed', 'blob-store'],
      ['service_unavailable', 'router', 'routes'],
      ['service_unavailable', 'teleport', 'teleport'],
    ],
  );
  // A service of the contract this host does not implement yet is unavailable too.
  assert.deepEqual(problems([candidate('router', { uses: ['routes'] })]), [
    ['service_unavailable', 'router', 'routes'],
  ]);
  // A disabled module may use services of a later contract.
  plan([candidate('later', { uses: ['teleport'] }, { enabled: false })]);
});

test('multi-role signed modules request the union of services available to their roles', () => {
  const result = plan(
    [
      candidate(
        'multi',
        {
          roles: ['api', 'worker', 'backup'],
          uses: ['routes', 'change-feed', 'blob-store', 'staged-completion', 'compute'],
        },
        signed,
      ),
    ],
    { ...host, services: HOST_SERVICES },
  );
  assert.equal(result.modules.find((m) => m.manifest.id === 'multi').enabled, true);
});

test('compute entries are bounded declarations inside the package, never arbitrary paths', () => {
  const good = { name: 'digest', entry: 'files/compute/digest.mjs' };
  assert.deepEqual(parseModuleManifest(manifest('digest', { compute: [good] })).compute, [good]);
  for (const entry of [
    '../task.mjs',
    '/task.mjs',
    'files/../task.mjs',
    'https://example.com/task.mjs',
  ])
    refused(manifest('digest', { compute: [{ ...good, entry }] }), 'format', '/compute/0');
  refused(manifest('digest', { compute: [good, good] }), 'format', '/compute/1');
  refused(manifest('digest', { compute: [{ ...good, extra: true }] }), 'format', '/compute/0');
});

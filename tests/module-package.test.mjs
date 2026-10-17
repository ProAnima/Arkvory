import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractModulePackage,
  inspectModulePackage,
  verifyInstalledModule,
} from '../packages/signing/dist/index.js';
import { packModule, signRevocations, tarGzip, ustarHeader } from '../scripts/module-signing.mjs';
import {
  manifestOf,
  operatorEntry,
  packageEntries,
  revocationList,
  sha256,
  temporaryDirectory,
  testHost,
  writePackage,
} from './module-fixtures.mjs';

const code = (expected) => (error) => error?.code === expected;

async function inspect(t, entries, host) {
  const directory = await temporaryDirectory(t);
  return inspectModulePackage(await writePackage(directory, entries), host);
}

async function refused(t, entries, host, expected) {
  await assert.rejects(inspect(t, entries, host), code(expected), expected);
}

test('a valid package is verified, unpacked and verified again where it is installed', async (t) => {
  const { host, module } = testHost();
  const directory = await temporaryDirectory(t);
  const file = await writePackage(directory, packageEntries({ signer: module }));
  const inspected = await inspectModulePackage(file, host);
  assert.equal(inspected.manifest.module.id, 'sample');
  assert.equal(inspected.manifest.package.dataClass, 'none');
  assert.deepEqual(inspected.signer, {
    source: 'signed',
    keyId: module.id,
    label: null,
    expired: false,
  });
  assert.equal(inspected.sha256, sha256(await readFile(file)));
  assert.deepEqual(inspected.terms, { text: '# Module terms\n\nTest terms.\n', truncated: false });
  assert.equal(inspected.revocations, null);
  const target = join(directory, 'installed');
  await extractModulePackage(file, inspected, target);
  assert.deepEqual((await readdir(target)).sort(), ['files', 'module.json', 'module.json.minisig']);
  assert.equal(await readFile(join(target, 'files/main.mjs'), 'utf8'), 'export const value = 1;\n');
  const loaded = await verifyInstalledModule(target, host);
  assert.equal(loaded.manifest.module.version, '1.0.0');
});

test('signature, key class and signer rules come before anything else of the manifest', async (t) => {
  const { host, module, release, license } = testHost();
  await refused(t, packageEntries({ signer: release }), host, 'wrong_key_class');
  await refused(t, packageEntries({ signer: license }), host, 'wrong_key_class');
  const stranger = testHost().module;
  await refused(t, packageEntries({ signer: stranger }), host, 'unknown_key');
  // One byte of the manifest changed after signing.
  const tamper = (bytes) => Buffer.from(bytes.toString().replace('1.0.0', '1.0.9'));
  await refused(t, packageEntries({ signer: module, tamper }), host, 'signature_invalid');
  await refused(
    t,
    packageEntries({ signer: module, purpose: 'other.json' }),
    host,
    'signature_purpose',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { publisher: 'acme' } }),
    host,
    'publisher_mismatch',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { id: 'op-acme-scan' } }),
    host,
    'namespace_mismatch',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { extra: true } }),
    host,
    'manifest_invalid',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { side: 'client' } }),
    host,
    'manifest_invalid',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { dataClass: 'other' } }),
    host,
    'manifest_invalid',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { entry: {} } }),
    host,
    'manifest_invalid',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { entry: { api: 'files/LICENSE.md' } } }),
    host,
    'manifest_invalid',
  );
});

test('operator keys sign only op- plugins their patterns cover', async (t) => {
  const { host, operator } = testHost();
  const plugin = { id: 'op-acme-scan', publisher: 'acme' };
  const accepted = await inspect(t, packageEntries({ signer: operator, manifest: plugin }), host);
  assert.deepEqual(accepted.signer, {
    source: 'operator',
    keyId: operator.id,
    label: 'Acme platform team',
    expired: false,
  });
  await refused(
    t,
    packageEntries({ signer: operator, manifest: { ...plugin, id: 'op-other' } }),
    host,
    'signer_scope',
  );
  await refused(
    t,
    packageEntries({ signer: operator, manifest: { ...plugin, id: 'scan' } }),
    host,
    'namespace_mismatch',
  );
  await refused(
    t,
    packageEntries({ signer: operator, manifest: { ...plugin, publisher: 'proanimastudio' } }),
    host,
    'publisher_mismatch',
  );
  await refused(
    t,
    packageEntries({ signer: operator, manifest: { ...plugin, licenseFeature: 'storage' } }),
    host,
    'license_feature_forbidden',
  );
  await refused(
    t,
    packageEntries({ signer: operator, manifest: { ...plugin, uses: ['license'] } }),
    host,
    'license_feature_forbidden',
  );
  // An expired key accepts no new installation, but an installed plugin still loads with a warning.
  const { host: late, operator: author } = testHost({ operators: [] });
  const entry = operatorEntry(author, { expiresAt: '2026-10-01T00:00:00Z' });
  const lateHost = {
    ...late,
    keys: [
      ...late.keys,
      { id: author.id, publicKey: author.key.publicKey, keyClass: 'operator', operator: entry },
    ],
  };
  const entries = packageEntries({ signer: author, manifest: plugin });
  await refused(t, entries, lateHost, 'signer_expired');
  const directory = await temporaryDirectory(t);
  const file = await writePackage(directory, entries);
  const inspected = await inspectModulePackage(file, {
    ...lateHost,
    now: Date.parse('2026-09-30T00:00:00Z'),
  });
  await extractModulePackage(file, inspected, join(directory, 'installed'));
  const loaded = await verifyInstalledModule(join(directory, 'installed'), lateHost, 'load');
  assert.equal(loaded.signer.expired, true);
});

test('the file list must match the archive exactly', async (t) => {
  const { host, module } = testHost();
  const files = { 'files/main.mjs': Buffer.from('export {};\n') };
  const listed = (data) => [{ path: 'files/main.mjs', size: data.length, sha256: sha256(data) }];
  await refused(
    t,
    packageEntries({ signer: module, files, listed: listed(Buffer.from('other')) }),
    host,
    'file_mismatch',
  );
  await refused(
    t,
    packageEntries({
      signer: module,
      files: { ...files, 'files/extra.mjs': Buffer.from('x') },
      listed: listed(files['files/main.mjs']),
    }),
    host,
    'file_unlisted',
  );
  await refused(
    t,
    packageEntries({ signer: module, files: {}, listed: listed(files['files/main.mjs']) }),
    host,
    'file_missing',
  );
  await refused(
    t,
    packageEntries({
      signer: module,
      files,
      listed: [{ path: 'files/../main.mjs', size: 1, sha256: '0'.repeat(64) }],
    }),
    host,
    'unsafe_path',
  );
});

test('archive paths that could escape, alias or mean something else are refused', async (t) => {
  const { host, module } = testHost();
  const base = () => packageEntries({ signer: module });
  const data = Buffer.from('x');
  const cases = [
    [{ path: '../evil.mjs', data }, 'unsafe_path'],
    [{ path: 'files/../../evil.mjs', data }, 'unsafe_path'],
    [{ path: '/etc/evil', data }, 'unsafe_path'],
    [{ path: 'C:/evil', data }, 'unsafe_path'],
    [{ path: 'files\\evil.mjs', data }, 'unsafe_path'],
    [{ path: 'files/./evil.mjs', data }, 'unsafe_path'],
    [{ path: 'files/con.txt', data }, 'unsafe_path'],
    [{ path: 'files/evil.', data }, 'unsafe_path'],
    [{ path: 'files/sp ace', data }, 'unsafe_path'],
    [{ path: 'files/link', type: '2', linkname: '/etc/passwd' }, 'link_entry'],
    [{ path: 'files/hard', type: '1', linkname: 'module.json' }, 'link_entry'],
    [{ path: 'files/dev', type: '3' }, 'special_entry'],
    [{ path: 'files/fifo', type: '6' }, 'special_entry'],
    [
      { path: 'PaxHeader', type: 'x', data: Buffer.from('20 path=files/x.mjs\n') },
      'extended_header',
    ],
    [{ path: 'files/main.mjs', data }, 'duplicate_entry'],
    [{ path: 'files/MAIN.mjs', data }, 'case_collision'],
    [{ path: 'Files/other.mjs', data }, 'case_collision'],
    [{ path: 'files/main.mjs/inner', data }, 'case_collision'],
    [{ path: 'files/addon.node', data }, 'native_addon'],
    [
      { path: 'package.json', data: Buffer.from('{"scripts":{"install":"x"}}') },
      'unexpected_entry',
    ],
    [{ path: 'other', type: '5' }, 'unexpected_entry'],
  ];
  for (const [entry, expected] of cases) await refused(t, [...base(), entry], host, expected);
});

test('declared sizes are refused before the data is read', async (t) => {
  const { host, module } = testHost();
  const header = (path, size) => ustarHeader({ path, size });
  const raw = (blocks) => gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  // The headers claim 300 MiB and 2 MiB that never follow: the reader stops at the header.
  await refused(t, raw([header('files/big.bin', 300 * 1024 ** 2)]), host, 'entry_too_large');
  await refused(t, raw([header('module.json', 2 * 1024 ** 2)]), host, 'entry_too_large');
  await refused(t, raw([header('module.json.minisig', 8192)]), host, 'entry_too_large');
  const many = Array.from({ length: 4097 }, (_, index) => header(`files/f${index}`, 0));
  await refused(t, raw(many), host, 'too_many_entries');
  await refused(
    t,
    packageEntries({ signer: module }).filter((e) => e.path !== 'module.json'),
    host,
    'manifest_missing',
  );
  await refused(
    t,
    packageEntries({ signer: module }).filter((e) => e.path !== 'module.json.minisig'),
    host,
    'signature_missing',
  );
});

test('broken containers are refused as archive_invalid', async (t) => {
  const { host, module } = testHost();
  const good = tarGzip(packageEntries({ signer: module }));
  const tar = gunzipSync(good);
  const checksum = Buffer.from(tar);
  checksum[148] = 0x37;
  const magic = Buffer.from(tar);
  magic.write('gnu  ', 257, 'latin1');
  const cases = [
    Buffer.from('not a gzip stream'),
    good.subarray(0, good.length - 20),
    gzipSync(tar.subarray(0, tar.length - 1024)),
    gzipSync(Buffer.concat([tar, Buffer.from('trailing')])),
    gzipSync(checksum),
    gzipSync(magic),
  ];
  for (const bytes of cases) await refused(t, bytes, host, 'archive_invalid');
});

test('a shipped revocation list is verified with the package', async (t) => {
  const { host, module, release } = testHost();
  const list = revocationList(module, { sequence: 3, entries: [] });
  const inspected = await inspect(t, packageEntries({ signer: module, revocations: list }), host);
  assert.equal(inspected.revocations.sequence, 3);
  const forged = revocationList(release, { sequence: 3, entries: [] });
  await refused(
    t,
    packageEntries({ signer: module, revocations: forged }),
    host,
    'wrong_key_class',
  );
});

test('extension API and core release ranges are checked after the files', async (t) => {
  const { host, module } = testHost();
  await refused(
    t,
    packageEntries({ signer: module, manifest: { extensionApi: '^9.0.0' } }),
    host,
    'module_incompatible',
  );
  await refused(
    t,
    packageEntries({ signer: module, manifest: { coreRelease: '^9.0.0' } }),
    host,
    'module_incompatible',
  );
  const inspected = await inspect(
    t,
    packageEntries({ signer: module, manifest: { coreRelease: '^0.6.0' } }),
    host,
  );
  assert.equal(inspected.manifest.package.coreRelease, '^0.6.0');
  // A development build has no release version; only the release range is skipped.
  await inspect(t, packageEntries({ signer: module, manifest: { coreRelease: '^9.0.0' } }), {
    ...host,
    coreVersion: '0.0.0-dev',
  });
});

test('an archive replaced between inspection and unpacking leaves nothing behind', async (t) => {
  const { host, module } = testHost();
  const directory = await temporaryDirectory(t);
  const file = await writePackage(directory, packageEntries({ signer: module }));
  const inspected = await inspectModulePackage(file, host);
  await writeFile(
    file,
    tarGzip(
      packageEntries({ signer: module, files: { 'files/main.mjs': Buffer.from('changed') } }),
    ),
  );
  const target = join(directory, 'installed');
  await assert.rejects(extractModulePackage(file, inspected, target), code('package_changed'));
  await assert.rejects(readdir(target), { code: 'ENOENT' });
});

test('an installed package changed on disk is refused before use', async (t) => {
  const { host, module } = testHost();
  const directory = await temporaryDirectory(t);
  const file = await writePackage(directory, packageEntries({ signer: module }));
  const inspected = await inspectModulePackage(file, host);
  const install = async (name) => {
    const target = join(directory, name);
    await extractModulePackage(file, inspected, target);
    return target;
  };
  const changed = await install('changed');
  await writeFile(join(changed, 'files/main.mjs'), 'export const value = 2;\n');
  await assert.rejects(verifyInstalledModule(changed, host), code('file_mismatch'));
  const extra = await install('extra');
  await writeFile(join(extra, 'files/injected.mjs'), 'export {};\n');
  await assert.rejects(verifyInstalledModule(extra, host), code('file_unlisted'));
  const root = await install('root');
  await writeFile(join(root, 'package.json'), '{}');
  await assert.rejects(verifyInstalledModule(root, host), code('unexpected_entry'));
  const linked = await install('linked');
  await mkdir(join(directory, 'elsewhere'));
  // A junction needs no privilege on Windows and is a directory link on Linux.
  await symlink(join(directory, 'elsewhere'), join(linked, 'files/link'), 'junction');
  await assert.rejects(verifyInstalledModule(linked, host), code('link_entry'));
  // Removed here: a recursive removal must never walk through a junction.
  await unlink(join(linked, 'files/link'));
  const unsigned = await install('unsigned');
  await writeFile(join(unsigned, 'module.json.minisig'), 'untrusted comment: x\n');
  await assert.rejects(verifyInstalledModule(unsigned, host), code('signature_malformed'));
});

test('the signing tool packs and signs packages and revocation lists the core accepts', async (t) => {
  const { host, module } = testHost();
  const directory = await temporaryDirectory(t);
  const source = join(directory, 'source');
  await mkdir(join(source, 'files/lib'), { recursive: true });
  await writeFile(join(source, 'module.json'), JSON.stringify(manifestOf()));
  await writeFile(join(source, 'files/main.mjs'), 'export {};\n');
  await writeFile(join(source, 'files/lib/util.mjs'), 'export const x = 1;\n');
  const payload = join(directory, 'payload.json');
  await writeFile(
    payload,
    JSON.stringify({ format: 1, sequence: 7, issuedAt: '2026-10-17T00:00:00Z', entries: [] }),
  );
  const list = join(directory, 'module-revocations.json');
  await signRevocations(payload, list, module);
  const output = join(directory, 'sample.tgz');
  await packModule(source, output, module, list);
  const inspected = await inspectModulePackage(output, host);
  assert.deepEqual(
    inspected.manifest.package.files.map((file) => file.path),
    ['files/lib/util.mjs', 'files/main.mjs'],
  );
  assert.equal(inspected.revocations.sequence, 7);
  // The tool never overwrites a package or a list.
  await assert.rejects(packModule(source, output, module), { code: 'EEXIST' });
  await assert.rejects(signRevocations(payload, list, module), { code: 'EEXIST' });
});

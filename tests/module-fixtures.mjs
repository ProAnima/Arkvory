import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_API_VERSION } from '../packages/extension-api/dist/index.js';
import {
  keyRing,
  publicKeyOf,
  revocationsEnvelope,
  signMinisign,
} from '../packages/signing/dist/index.js';
import { tarGzip } from '../scripts/module-signing.mjs';
import { removeTestDirectory } from './helpers.mjs';

/** A throwaway Ed25519 key: real signing keys never leave the release workstation. */
export function testKey() {
  const pem = generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const id = randomBytes(8).toString('hex');
  return { pem, id, privateKey: pem, key: { id, publicKey: publicKeyOf(pem) } };
}

export function sign(bytes, key, purpose = 'module.json') {
  return signMinisign(bytes, key.pem, key.id, `timestamp:1\tfile:${purpose}`, 'test signature');
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function operatorEntry(key, overrides = {}) {
  return {
    keyId: key.id,
    publicKey: key.key.publicKey,
    label: 'Acme platform team',
    plugins: ['op-acme-*'],
    allowInProcess: false,
    addedAt: '2026-10-17T10:00:00Z',
    addedBy: 'root@host-a',
    expiresAt: null,
    ...overrides,
  };
}

/** Keys of every class a test host knows, and the host of the package checks. */
export function testHost(overrides = {}) {
  const module = testKey();
  const release = testKey();
  const license = testKey();
  const operator = testKey();
  const operators = overrides.operators ?? [operatorEntry(operator)];
  return {
    module,
    release,
    license,
    operator,
    host: {
      keys: keyRing({
        module: [module.key],
        release: [release.key],
        license: [license.key],
        operator: operators,
      }),
      extensionApi: EXTENSION_API_VERSION,
      coreVersion: '0.6.0',
      now: Date.parse('2026-10-17T12:00:00Z'),
    },
  };
}

export function manifestOf(overrides = {}) {
  return {
    format: 1,
    id: 'sample',
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
    side: 'server',
    entry: { api: 'files/main.mjs' },
    dataClass: 'none',
    licenseFeature: null,
    ...overrides,
  };
}

export const defaultFiles = () => ({
  'files/main.mjs': Buffer.from('export const value = 1;\n'),
  'files/LICENSE.md': Buffer.from('# Module terms\n\nTest terms.\n'),
});

/**
 * The entries of a package archive: a manifest listing `files` (or `listed` instead), signed by
 * `signer`, and optional extra or replacement entries to build broken packages.
 */
export function packageEntries({
  signer,
  manifest = {},
  files = defaultFiles(),
  listed,
  purpose = 'module.json',
  extra = [],
  tamper = (bytes) => bytes,
  revocations,
}) {
  const list =
    listed ??
    Object.entries(files).map(([path, data]) => ({
      path,
      size: data.length,
      sha256: sha256(data),
    }));
  const bytes = Buffer.from(JSON.stringify({ ...manifestOf(manifest), files: list }, null, 2));
  const signature = sign(bytes, signer, purpose);
  return [
    { path: 'module.json', data: tamper(bytes) },
    { path: 'module.json.minisig', data: Buffer.from(signature) },
    ...(revocations ? [{ path: 'module-revocations.json', data: Buffer.from(revocations) }] : []),
    { path: 'files', type: '5' },
    ...Object.entries(files).map(([path, data]) => ({ path, data })),
    ...extra,
  ];
}

/** A signed revocation list envelope. */
export function revocationList(signer, payload, purpose = 'module-revocations.json') {
  const bytes = Buffer.from(
    JSON.stringify({
      format: 1,
      issuedAt: '2026-10-17T10:00:00Z',
      expiresAt: '2027-01-15T10:00:00Z',
      ...payload,
    }),
  );
  return revocationsEnvelope(bytes, sign(bytes, signer, purpose));
}

export async function temporaryDirectory(t, prefix = 'arkvory-module-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

/** Writes an archive of `entries` (or raw bytes) and returns its path. */
export async function writePackage(directory, entries, name = 'package.tgz') {
  const file = join(directory, name);
  await writeFile(file, Buffer.isBuffer(entries) ? entries : tarGzip(entries));
  return file;
}

/** The fields of `manifestOf` that describe the module rather than the package. */
const PACKAGE_ONLY = ['side', 'entry', 'dataClass', 'licenseFeature', 'coreRelease', 'files'];

export function moduleManifestOf(overrides = {}) {
  return Object.fromEntries(
    Object.entries(manifestOf(overrides)).filter(([key]) => !PACKAGE_ONLY.includes(key)),
  );
}

/**
 * The entry of a test module: a default-exported descriptor whose manifest is the signed one
 * (or `options.manifest`). Importing it appends `<id>@<version>` to `globalThis.arkvoryImported`,
 * so a test sees whether the loader ever ran a package's code. `options`: `throwOnImport`,
 * `createThrows`, `startFails`, `startHangs`, `requireConfig` (settings must be `{"mode":"on"}`),
 * `health` (`ok`, `degraded` or `failed`).
 */
export function moduleSource(manifest, options = {}) {
  return Buffer.from(`const manifest = ${JSON.stringify(options.manifest ?? manifest)};
const options = ${JSON.stringify(options)};
globalThis.arkvoryImported = [...(globalThis.arkvoryImported ?? []), manifest.id + '@' + manifest.version];
if (options.throwOnImport) throw new Error('module refuses to load');
export default {
  manifest,
  parseConfig(input) {
    if (options.requireConfig && (typeof input !== 'object' || input === null || input.mode !== 'on'))
      throw new Error('mode required');
    return input ?? {};
  },
  describeConfig: () => ({}),
  create(context) {
    if (options.createThrows) throw new Error('cannot create');
    return {
      async start(signal) {
        if (options.startFails) throw new Error('cannot start');
        if (options.startHangs)
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      },
      async drain() {},
      async stop() {},
      health: () => ({
        status: options.health ?? 'ok',
        code: (options.health ?? 'ok') === 'ok' ? null : 'test_reason',
      }),
    };
  },
};
`);
}

/** A package whose entry for every role is a `moduleSource` of its own manifest. */
export function modulePackage(signer, manifest = {}, options = {}) {
  const roles = manifest.roles ?? ['api', 'reader'];
  const full = {
    roles,
    entry: Object.fromEntries(roles.map((r) => [r, 'files/main.mjs'])),
    ...manifest,
  };
  return packageEntries({
    signer,
    manifest: full,
    files: {
      'files/main.mjs': moduleSource(moduleManifestOf(full), options),
      'files/LICENSE.md': Buffer.from('# Module terms\n\nTest terms.\n'),
    },
  });
}

/**
 * Takes the inherited access away from a test installation root exactly as the installers do:
 * on Windows SYSTEM and Administrators with full control, LocalService reading, and the owner of
 * the root, which the loader trusts too (the current user, or the Administrators group for an
 * elevated process such as a CI runner); on POSIX mode 0700. A grant to the current user's own
 * SID would be another writer under an elevated process, whose root belongs to Administrators,
 * and a temporary directory of a Windows profile can grant other local accounts write access.
 */
export async function protectRoot(root) {
  if (process.platform !== 'win32') return chmod(root, 0o700);
  const script = [
    '$owner = [IO.Directory]::GetAccessControl($env:ARKVORY_TEST_ROOT).GetOwner([Security.Principal.SecurityIdentifier]).Value',
    // /reset drops rules written on the directory itself (a runner's default DACL writes one for
    // its account, which is not the owner when an elevated process creates for Administrators).
    '& icacls.exe $env:ARKVORY_TEST_ROOT /reset | Out-Null',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    "& icacls.exe $env:ARKVORY_TEST_ROOT /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' ('*' + $owner + ':(OI)(CI)F') | Out-Null",
    'exit $LASTEXITCODE',
  ].join('; ');
  // .NET rather than Get-Acl, and no PSModulePath: a runner step in PowerShell 7 hands its module
  // path down, and Windows PowerShell cannot load the Security module of PowerShell 7.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...env, ARKVORY_TEST_ROOT: root },
    windowsHide: true,
  });
}

/** Lets everyone change `path`: the access the loader must refuse. */
export async function openToEveryone(path) {
  if (process.platform !== 'win32') return chmod(path, 0o666);
  execFileSync('icacls.exe', [path, '/grant', '*S-1-1-0:M'], { windowsHide: true });
}

/**
 * An installation root with a current revocation list (valid until 2027-01-15) and the module
 * commands of `arkvory` bound to it and to throwaway keys. `install(entries)` writes a package
 * and installs it with `--yes`; `source(keys)` is what a service of this root loads with.
 */
export async function moduleInstallation(t, { extensionApi = EXTENSION_API_VERSION } = {}) {
  const root = await temporaryDirectory(t, 'arkvory-loader-root-');
  const files = await temporaryDirectory(t, 'arkvory-loader-files-');
  await protectRoot(root);
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
        version: '0.6.0',
        commit: 'a'.repeat(40),
        schema: 43,
        archiveSha256: 'b'.repeat(64),
        setupSha256: 'c'.repeat(64),
      },
    }),
  );
  const keys = testHost();
  await writeFile(
    join(root, 'config/module-revocations.json'),
    revocationList(keys.module, { sequence: 1, entries: [] }),
  );
  const context = {
    moduleKeys: [keys.module.key],
    licenseKeys: [keys.license.key],
    releaseKeys: [keys.release.key],
    extensionApi,
    now: () => Date.parse('2026-10-17T12:00:00Z'),
    print: () => undefined,
  };
  const { moduleCommand } = await import('../apps/deploy/dist/module-commands.js');
  const run = (...args) => moduleCommand([...args, '--root', root], context);
  let count = 0;
  const install = async (entries, ...flags) =>
    run('install', await writePackage(files, entries, `m${++count}.tgz`), '--yes', ...flags);
  const writeFileIn = (name, text) => writePackage(files, Buffer.from(text), name);
  return {
    root,
    keys,
    run,
    install,
    writeFileIn,
    modules: join(root, 'modules'),
    source: (moduleKeys = [keys.module.key]) => ({
      directory: join(root, 'modules'),
      revocationsFile: join(root, 'config/module-revocations.json'),
      keys: moduleKeys,
    }),
  };
}

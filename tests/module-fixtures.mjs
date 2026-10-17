import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
    JSON.stringify({ format: 1, issuedAt: '2026-10-17T10:00:00Z', ...payload }),
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

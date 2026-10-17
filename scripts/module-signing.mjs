import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  MANIFEST_FILE,
  REVOCATIONS_FILE,
  REVOCATION_VALIDITY_DAYS,
  SIGNATURE_FILE,
  publicKeyOf,
  revocationsEnvelope,
  signMinisign,
  verifyMinisign,
} from '../packages/signing/dist/index.js';

/**
 * Module and license signing (ADR 0078, 3.2 and 6.1). Private keys never enter the repository,
 * CI or the hub: each is a file on the module release workstation, under ~/.proanima or the
 * path of ARKVORY_MODULE_SIGNING_KEY_FILE / ARKVORY_LICENSE_SIGNING_KEY_FILE. Installations
 * trust only the public keys built into packages/signing/src/keys.ts.
 */
const usage = `Usage: node scripts/module-signing.mjs keygen module|license
       node scripts/module-signing.mjs pack <module-dir> <output.tgz> [--revocations <file>]
       node scripts/module-signing.mjs revocations <payload.json> <output.json>`;

export function signingKeyFile(keyClass) {
  const variable =
    keyClass === 'license' ? 'ARKVORY_LICENSE_SIGNING_KEY_FILE' : 'ARKVORY_MODULE_SIGNING_KEY_FILE';
  return process.env[variable] || join(homedir(), '.proanima', `arkvory-${keyClass}-signing.key`);
}

export async function readSigningKey(path, keyClass) {
  const key = JSON.parse(await readFile(path, 'utf8'));
  if (
    key.format !== 1 ||
    key.class !== keyClass ||
    !/^[0-9a-f]{16}$/.test(key.id) ||
    typeof key.privateKey !== 'string'
  )
    throw Error(`Invalid ${keyClass} signing key file`);
  return key;
}

/** One POSIX ustar header; `type` '0' is a file, '5' a directory (others only for tests). */
export function ustarHeader({ path, size = 0, type = '0', linkname = '' }) {
  const header = Buffer.alloc(512);
  const name = Buffer.from(path, 'latin1');
  let prefix = Buffer.alloc(0);
  let base = name;
  if (name.length > 100) {
    const cut = path.lastIndexOf('/', 155);
    if (cut <= 0 || name.length - cut - 1 > 100) throw Error(`Path too long for ustar: ${path}`);
    prefix = name.subarray(0, cut);
    base = name.subarray(cut + 1);
  }
  base.copy(header, 0);
  header.write(type === '5' ? '0000755\0' : '0000644\0', 100, 'latin1');
  header.write('0000000\0', 108, 'latin1');
  header.write('0000000\0', 116, 'latin1');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
  header.write('00000000000\0', 136, 'latin1');
  header.write('        ', 148, 'latin1');
  header.write(type, 156, 'latin1');
  header.write(linkname, 157, 'latin1');
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263, 'latin1');
  prefix.copy(header, 345);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return header;
}

/** A gzip-compressed ustar archive of `{path, data, type}` entries, in the given order. */
export function tarGzip(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    blocks.push(ustarHeader({ ...entry, size: entry.size ?? data.length }));
    if (data.length) blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

async function listFiles(root, directory = 'files') {
  const result = [];
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push({ path, type: '5' }, ...(await listFiles(root, path)));
    else if (entry.isFile()) result.push({ path, data: await readFile(join(root, path)) });
    else throw Error(`Only files and directories can be packed: ${path}`);
  }
  return result;
}

/**
 * Packs `<module-dir>/module.json` (without `files`) and `<module-dir>/files/` into a signed
 * package: the manifest gets the list of files with sizes and SHA-256, its exact bytes are
 * signed with the purpose `file:module.json`, and the signature is checked before the archive
 * is written.
 */
export async function packModule(directory, output, key, revocationsFile = null) {
  const source = JSON.parse(await readFile(join(directory, MANIFEST_FILE), 'utf8'));
  if ('files' in source) throw Error('module.json lists its files when packed; remove "files"');
  const tree = await listFiles(directory);
  const files = tree
    .filter((entry) => entry.data)
    .map((entry) => ({
      path: entry.path,
      size: entry.data.length,
      sha256: createHash('sha256').update(entry.data).digest('hex'),
    }));
  const manifest = Buffer.from(JSON.stringify({ ...source, files }, null, 2) + '\n');
  const comment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${MANIFEST_FILE}\tid:${source.id}\tversion:${source.version}`;
  const signature = signMinisign(
    manifest,
    key.privateKey,
    key.id,
    comment,
    `signature from ProAnima Arkvory module key ${key.id}`,
  );
  verifyMinisign(manifest, signature, [{ id: key.id, publicKey: publicKeyOf(key.privateKey) }]);
  const entries = [
    { path: MANIFEST_FILE, data: manifest },
    { path: SIGNATURE_FILE, data: Buffer.from(signature) },
    ...(revocationsFile ? [{ path: REVOCATIONS_FILE, data: await readFile(revocationsFile) }] : []),
    { path: 'files', type: '5' },
    ...tree,
  ];
  await writeFile(output, tarGzip(entries), { flag: 'wx' });
}

const DAY = 24 * 60 * 60 * 1000;
const utc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Signs a revocation list payload (ADR 0078, 3.4) into its envelope. `issuedAt` defaults to
 * now and `expiresAt` to 90 days later; a validity over 180 days is refused, as the core would.
 */
export async function signRevocations(payloadFile, output, key) {
  const source = JSON.parse(await readFile(payloadFile, 'utf8'));
  if (source.format !== 1 || !Number.isSafeInteger(source.sequence) || source.sequence < 1)
    throw Error('A revocation list needs format 1 and a positive integer sequence');
  const issuedAt = source.issuedAt ?? utc(Date.now());
  const expiresAt =
    source.expiresAt ?? utc(Date.parse(issuedAt) + REVOCATION_VALIDITY_DAYS.default * DAY);
  const validity = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (!(validity > 0 && validity <= REVOCATION_VALIDITY_DAYS.maximum * DAY))
    throw Error('expiresAt must follow issuedAt by at most 180 days');
  const list = { ...source, issuedAt, expiresAt };
  const payload = Buffer.from(JSON.stringify(list));
  const comment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${REVOCATIONS_FILE}\tsequence:${list.sequence}`;
  const signature = signMinisign(
    payload,
    key.privateKey,
    key.id,
    comment,
    `signature from ProAnima Arkvory module key ${key.id}`,
  );
  await writeFile(output, revocationsEnvelope(payload, signature), { flag: 'wx' });
}

async function keygen(keyClass) {
  if (keyClass !== 'module' && keyClass !== 'license') throw Error(usage);
  const path = signingKeyFile(keyClass);
  await mkdir(dirname(path), { recursive: true });
  const pem = generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();
  const id = randomBytes(8).toString('hex');
  // 'wx': an existing key is never replaced; installations would stop trusting its packages.
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(
      JSON.stringify({ format: 1, class: keyClass, id, privateKey: pem }, null, 2) + '\n',
    );
  } finally {
    await file.close();
  }
  process.stdout.write(
    `Signing key: ${path}\nBack it up offline. Add to ${keyClass}Keys in packages/signing/src/keys.ts:\n` +
      `  { id: '${id}', publicKey: '${publicKeyOf(pem)}' },\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, first, second, option, value] = process.argv.slice(2);
  if (command === 'keygen') await keygen(first);
  else if (command === 'pack' && first && second && (!option || option === '--revocations'))
    await packModule(
      first,
      second,
      await readSigningKey(signingKeyFile('module'), 'module'),
      value ?? null,
    );
  else if (command === 'revocations' && first && second)
    await signRevocations(first, second, await readSigningKey(signingKeyFile('module'), 'module'));
  else throw Error(usage);
}

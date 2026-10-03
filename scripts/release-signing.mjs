import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  releasePublicKey,
  signRelease,
  verifyReleaseSignature,
} from '../apps/deploy/dist/release-signature.js';
import { releaseKeys } from '../apps/deploy/dist/release-keys.js';

/**
 * Release signing (ADR 0060). The private key never enters the repository, CI or the hub: it is
 * a file on the release workstation, ARKVORY_SIGNING_KEY_FILE or ~/.proanima. Installations
 * trust only the public keys built into apps/deploy/src/release-keys.ts.
 */
export const signingKeyFile = () =>
  process.env.ARKVORY_SIGNING_KEY_FILE ||
  join(homedir(), '.proanima', 'arkvory-release-signing.key');
export const signedFiles = ['arkvory-release.json.sig', 'latest.json'];
const platforms = ['linux-x86_64', 'windows-x86_64'];
const usage = `Usage: node scripts/release-signing.mjs keygen | sign <artifact-dir> | sign-draft <x.y.z>`;

async function signingKey() {
  const key = JSON.parse(await readFile(signingKeyFile(), 'utf8'));
  if (key.format !== 1 || !/^[0-9a-f]{16}$/.test(key.id) || typeof key.privateKey !== 'string')
    throw Error('Invalid signing key file');
  return key;
}

/** Writes arkvory-release.json.sig and the hub's latest.json next to the release manifest. */
export async function signDirectory(directory, keyFile = undefined, trusted = releaseKeys) {
  const key = keyFile ? JSON.parse(await readFile(keyFile, 'utf8')) : await signingKey();
  const manifestBytes = await readFile(join(directory, 'arkvory-release.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Invalid release manifest');
  const comment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:arkvory-release.json\tversion:${manifest.version}`;
  const signature = signRelease(manifestBytes, key.privateKey, key.id, comment);
  // A key the released updaters do not know would publish an uninstallable release.
  verifyReleaseSignature(manifestBytes, signature, trusted);
  const url = `https://github.com/ProAnima/Arkvory/releases/download/v${manifest.version}/arkvory-release.json`;
  const latest = {
    version: manifest.version,
    notes: `ProAnima Arkvory ${manifest.version}`,
    pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(
      platforms.map((name) => [
        name,
        { signature: Buffer.from(signature).toString('base64'), url },
      ]),
    ),
  };
  await writeFile(join(directory, 'arkvory-release.json.sig'), signature);
  await writeFile(join(directory, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  return signedFiles.map((name) => join(directory, name));
}

async function keygen() {
  const path = signingKeyFile();
  await mkdir(dirname(path), { recursive: true });
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const id = randomBytes(8).toString('hex');
  // 'wx': an existing key is never replaced; installations would stop trusting new releases.
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ format: 1, id, privateKey: pem }, null, 2) + '\n');
  } finally {
    await file.close();
  }
  process.stdout.write(
    `Signing key: ${path}\nBack it up offline. Add to apps/deploy/src/release-keys.ts:\n` +
      `  { id: '${id}', publicKey: '${releasePublicKey(pem)}' },\n`,
  );
}

/** Signs a draft created by the GitHub release workflow, which has no access to the key. */
async function signDraft(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw Error(usage);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-sign-'));
  try {
    const gh = (args) => execFileSync('gh', args, { stdio: 'inherit' });
    const repository = ['--repo', 'ProAnima/Arkvory'];
    gh([
      'release',
      'download',
      `v${version}`,
      ...repository,
      '-p',
      'arkvory-release.json',
      '-D',
      directory,
    ]);
    const files = await signDirectory(directory);
    gh(['release', 'upload', `v${version}`, ...repository, '--clobber', ...files]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'keygen') await keygen();
  else if (command === 'sign' && argument) await signDirectory(argument);
  else if (command === 'sign-draft') await signDraft(argument);
  else throw Error(usage);
}

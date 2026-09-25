import { createReadStream } from 'node:fs';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const releaseFiles = [
  'depot-runtime.zip',
  'depot-setup.mjs',
  'depot-release.json',
  'install.sh',
  'install.ps1',
  'Depot-Windows.zip',
  'Depot-Linux.tar.gz',
];
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyReleaseFiles(directory, version, commit) {
  const inventory = JSON.parse(await readFile(join(directory, 'release-checksums.json'), 'utf8'));
  if (inventory.version !== version || inventory.commit !== commit || inventory.format !== 1)
    throw Error('Release inventory identity mismatch');
  if (
    JSON.stringify(Object.keys(inventory.files ?? {}).sort()) !==
    JSON.stringify([...releaseFiles].sort())
  )
    throw Error('Release inventory must contain exactly the supported assets');
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...releaseFiles, 'release-checksums.json'].sort()))
    throw Error('Unexpected or missing release assets');
  for (const name of releaseFiles) {
    const info = await lstat(join(directory, name));
    if (!info.isFile() || info.size > 1024 ** 3 || !/^[a-f0-9]{64}$/.test(inventory.files[name]))
      throw Error('Invalid release asset');
    if ((await sha256(join(directory, name))) !== inventory.files[name])
      throw Error(`Checksum mismatch: ${name}`);
  }
  const manifest = JSON.parse(await readFile(join(directory, 'depot-release.json'), 'utf8'));
  if (
    manifest.version !== version ||
    manifest.commit !== commit ||
    manifest.archiveSha256 !== inventory.files['depot-runtime.zip'] ||
    manifest.setupSha256 !== inventory.files['depot-setup.mjs']
  )
    throw Error('Release manifest mismatch');
}

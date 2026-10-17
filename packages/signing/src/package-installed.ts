import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SigningError } from './errors.js';
import { PACKAGE_LIMITS } from './package-manifest.js';
import {
  EntryNames,
  FILES_DIRECTORY,
  MANIFEST_FILE,
  SIGNATURE_FILE,
  refuseNativeAddon,
  safePath,
} from './package-paths.js';
import { compareFiles, verifySignedManifest } from './package-verify.js';
import type { PackageHost, ReadFile, SignedManifest } from './package-verify.js';
import type { SignerPurpose } from './signer.js';

/**
 * Opens a file without following a link that replaced it after the listing. Windows has no
 * O_NOFOLLOW; there the listing's link check and the administrator-only directory remain.
 */
const READ_FLAGS = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, READ_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new SigningError('special_entry');
    if (info.size > limit) throw new SigningError('entry_too_large');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function hashFile(path: string): Promise<ReadFile> {
  const handle = await open(path, READ_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new SigningError('special_entry');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ highWaterMark: 64 * 1024 })) {
      if (!Buffer.isBuffer(chunk)) throw new SigningError('special_entry');
      size += chunk.length;
      if (size > PACKAGE_LIMITS.fileBytes) throw new SigningError('entry_too_large');
      hash.update(chunk);
    }
    return { size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

/**
 * Every file under `files/` with the same rules as an archive entry: links and junctions
 * (reported as symbolic links), devices and sockets are refused, names follow the path rules
 * and differ in more than letter case.
 */
async function listFiles(root: string, names: EntryNames): Promise<string[]> {
  const result: string[] = [];
  const pending = [FILES_DIRECTORY];
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop() ?? FILES_DIRECTORY;
    for (const item of await readdir(join(root, ...directory.split('/')), {
      withFileTypes: true,
    })) {
      if (++entries > PACKAGE_LIMITS.entries) throw new SigningError('too_many_entries');
      const path = safePath(`${directory}/${item.name}`);
      if (item.isSymbolicLink()) throw new SigningError('link_entry', path);
      if (item.isDirectory()) {
        names.add(path, 'directory');
        pending.push(path);
      } else if (item.isFile()) {
        names.add(path, 'file');
        refuseNativeAddon(path);
        result.push(path);
      } else throw new SigningError('special_entry', path);
    }
  }
  return result;
}

/**
 * The check of an installed package each time it is about to be used (ADR 0078, 3.3, step 2):
 * the directory holds exactly `module.json`, its signature and `files/`; the signature, the
 * manifest and the signer are verified again and every file is hashed again. A file replaced,
 * added or linked after installation is refused before any code of the package is imported.
 * What is verified here is what the caller may then import: the directory must stay writable
 * only by the host administrator, which the installer ensures.
 */
export async function verifyInstalledModule(
  directory: string,
  host: PackageHost,
  purpose: SignerPurpose = 'load',
): Promise<SignedManifest> {
  const names = new EntryNames();
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = safePath(item.name);
    if (item.isSymbolicLink()) throw new SigningError('link_entry', path);
    const directoryEntry = path === FILES_DIRECTORY;
    if (!directoryEntry && path !== MANIFEST_FILE && path !== SIGNATURE_FILE)
      throw new SigningError('unexpected_entry', path);
    if (directoryEntry ? !item.isDirectory() : !item.isFile())
      throw new SigningError('special_entry', path);
    names.add(path, directoryEntry ? 'directory' : 'file');
  }
  const manifestBytes = await readBounded(
    join(directory, MANIFEST_FILE),
    PACKAGE_LIMITS.manifestBytes,
  ).catch((error: unknown) => missing(error, 'manifest_missing'));
  const signature = await readBounded(
    join(directory, SIGNATURE_FILE),
    PACKAGE_LIMITS.signatureBytes,
  ).catch((error: unknown) => missing(error, 'signature_missing'));
  const signed = verifySignedManifest(manifestBytes, signature, host, purpose);
  const found = new Map<string, ReadFile>();
  const files = await listFiles(directory, names).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const path of files) found.set(path, await hashFile(join(directory, ...path.split('/'))));
  compareFiles(signed, found, host);
  return signed;
}

function missing(error: unknown, code: 'manifest_missing' | 'signature_missing'): never {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    throw new SigningError(code);
  throw error;
}

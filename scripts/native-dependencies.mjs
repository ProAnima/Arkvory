import { randomUUID } from 'node:crypto';
import { mkdir, access, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { sha256 } from './release-files.mjs';

export const dependencies = {
  nodeWindows: [
    'https://nodejs.org/dist/v24.22.3/node-v24.22.3-win-x64.zip',
    'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f',
  ],
  nodeLinux: [
    'https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz',
    '4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb',
  ],
  postgres: [
    'https://get.enterprisedb.com/postgresql/postgresql-18.7-1-windows-x64-binaries.zip',
    'ead0bbc27fb678fa24dcf86b738981323042abd073c744103bf7f3aed23f9a33',
  ],
  winsw: [
    'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
    '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da',
  ],
  compiler: [
    'https://github.com/jrsoftware/issrc/releases/download/is-6_7_4/innosetup-6.7.4.exe',
    'a549929319f9120716677c685535ca4671e4b937b5fdc87e2585f32d8eb30e8c',
  ],
  visualCpp: [
    'https://download.visualstudio.microsoft.com/download/pr/bd1c8d9d-ba95-4eee-bc6e-df1fcc876373/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe',
    'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b',
  ],
};
export async function dependency(name, cache) {
  const pinned = dependencies[name];
  if (!pinned) throw Error('Unknown native dependency');
  return pinnedDownload(name, pinned, cache);
}
/** Downloads once into the cache and verifies the pinned SHA-256 on every use. */
export async function pinnedDownload(name, [url, hash], cache) {
  await mkdir(cache, { recursive: true });
  const path = join(cache, hash + (url.endsWith('.exe') ? '.exe' : '.archive'));
  let exists = false;
  try {
    await access(path);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!exists) {
    // A partial file under the final name would fail the checksum on every later run.
    const partial = `${path}.${randomUUID()}.tmp`;
    try {
      await download(name, url, partial);
      if ((await sha256(partial)) !== hash) throw Error(`Dependency checksum mismatch: ${name}`);
      await rename(partial, path);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }
  if ((await sha256(path)) !== hash) throw Error(`Dependency checksum mismatch: ${name}`);
  return path;
}
async function download(name, url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw Error(`Dependency download failed: ${name}`);
  let bytes = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > 600 * 1024 ** 2) throw Error('Dependency too large');
        yield chunk;
      }
    },
    createWriteStream(path, { flags: 'wx' }),
  );
}

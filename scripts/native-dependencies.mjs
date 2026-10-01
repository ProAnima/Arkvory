import { mkdir, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { sha256 } from './release-files.mjs';

export const dependencies = {
  nodeWindows: [
    'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
    '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  ],
  nodeLinux: [
    'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz',
    'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
  ],
  postgres: [
    'https://get.enterprisedb.com/postgresql/postgresql-18.4-1-windows-x64-binaries.zip',
    '7effe34c0bf89027b3f171447d351cbc460f4566c8d0f643daec67f140787858',
  ],
  winsw: [
    'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
    '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da',
  ],
  compiler: [
    'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe',
    '9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732',
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
  if ((await sha256(path)) !== hash) throw Error(`Dependency checksum mismatch: ${name}`);
  return path;
}

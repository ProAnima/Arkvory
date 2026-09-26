import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, chmod, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, jsonFile, inside, syncDirectory } from './files.js';
import { parseRelease } from './model.js';
import type { Release } from './model.js';
import { GitHubReleases } from './github.js';
import { extractArchive } from './archive.js';

export interface Source {
  release: Release;
  archive: () => Promise<string>;
}
export async function source(
  root: string,
  pin: string | null,
  local: string | undefined,
): Promise<Source> {
  if (local) {
    const release = parseRelease(await jsonFile(join(local, 'arkvory-release.json')));
    if (pin !== null && pin !== release.version)
      throw new Error('Artifact version does not match pin');
    return { release, archive: () => Promise.resolve(join(local, 'arkvory-runtime.zip')) };
  }
  const github = await GitHubReleases.fromTokenFile(join(root, 'github-token.txt'));
  const selected = await github.resolve(pin);
  return {
    release: selected.release,
    archive: async () => {
      const destination = inside(root, `download-${randomUUID()}.zip`);
      await github.download(selected.archiveUrl, destination, selected.release.archiveSha256);
      return destination;
    },
  };
}
export async function stage(root: string, source: Source): Promise<void> {
  const destination = inside(root, 'releases', source.release.version);
  try {
    const installed = parseRelease(await jsonFile(join(destination, 'release.json')));
    if (installed.archiveSha256 !== source.release.archiveSha256)
      throw new Error('Existing release differs');
    return;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const archive = await source.archive();
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const raw of createReadStream(archive)) {
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive bytes');
    bytes += chunk.length;
    if (bytes > 512 * 1024 ** 2) throw new Error('Archive too large');
    hash.update(chunk);
  }
  if (hash.digest('hex') !== source.release.archiveSha256)
    throw new Error('Release checksum mismatch');
  await mkdir(join(root, 'releases'), { recursive: true });
  await chmod(join(root, 'releases'), 0o755);
  const temporary = inside(root, 'releases', `.stage-${randomUUID()}`);
  await extractArchive(archive, temporary);
  for (const name of [
    'apps/api/dist/main.js',
    'apps/worker/dist/main.js',
    'apps/api/dist/migrate.js',
    'apps/deploy/dist/main.js',
    'deploy/launcher.mjs',
    'package.json',
  ])
    await access(inside(temporary, name));
  await atomicJson(join(temporary, 'release.json'), source.release);
  await readableTree(temporary);
  await rename(temporary, destination);
  await syncDirectory(join(root, 'releases'));
}
async function readableTree(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await readableTree(path);
  }
  await syncDirectory(directory);
}

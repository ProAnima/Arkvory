import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, chmod, access, readdir, readFile, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, jsonFile, inside, syncDirectory } from './files.js';
import { parseRelease } from './model.js';
import type { Release } from './model.js';
import { GitHubReleases } from './github.js';
import type { ReleaseAssets, ReleaseSource } from './github.js';
import { HubReleases } from './hub.js';
import type { HubClient } from './hub.js';
import { hubSettings, installId } from './hub-settings.js';
import { report } from './output.js';
import { ReleaseHttpError } from './release-http.js';
import { releaseKeys } from './release-keys.js';
import { verifyReleaseSignature } from './release-signature.js';
import { extractArchive } from './archive.js';
import { sameTree } from './release-tree.js';

export interface Source {
  release: Release;
  archive: () => Promise<string>;
}
/** The hub of this installation, or null when the operator turned it off. */
export async function hubClient(root: string): Promise<HubClient | null> {
  const settings = await hubSettings(root);
  if (settings.url === null) return null;
  return {
    settings: { ...settings, url: settings.url },
    installId: settings.statistics ? await installId(root) : null,
  };
}
/** No answer at all, or a server failure: the only cases in which GitHub replaces the hub. */
function unreachable(error: unknown): boolean {
  if (error instanceof ReleaseHttpError) return error.status >= 500;
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}
/**
 * The hub decides first (ADR 0060). GitHub's latest stable release is read only when the hub
 * cannot be reached; a refusal, a missing file or a bad signature from the hub is an error.
 */
export async function chooseRelease(
  hub: ReleaseSource | null,
  github: () => Promise<ReleaseSource>,
  pin: string | null,
  current: Release | null,
): Promise<{ selected: ReleaseAssets | null; from: ReleaseSource }> {
  if (hub)
    try {
      return { selected: await hub.resolve(pin, current), from: hub };
    } catch (error) {
      if (!unreachable(error)) throw error;
      report('warning', 'The update hub cannot be reached; reading GitHub releases instead');
    }
  const direct = await github();
  return { selected: await direct.resolve(pin, current), from: direct };
}
export async function selectRelease(
  root: string,
  pin: string | null,
  current: Release | null,
  signal?: AbortSignal,
): Promise<{ selected: ReleaseAssets | null; from: ReleaseSource }> {
  const client = await hubClient(root);
  return chooseRelease(
    client ? new HubReleases(client, signal) : null,
    () => GitHubReleases.fromTokenFile(join(root, 'github-token.txt'), signal),
    pin,
    current,
  );
}
export async function source(
  root: string,
  pin: string | null,
  local: string | undefined,
  current: Release | null = null,
): Promise<Source> {
  if (local) {
    const manifest = await readFile(join(local, 'arkvory-release.json'));
    // A local artifact is the operator's choice; a signature shipped next to it is still checked.
    const signature = await readFile(join(local, 'arkvory-release.json.sig'), 'utf8').catch(
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (signature !== null) verifyReleaseSignature(manifest, signature, releaseKeys);
    const release = parseRelease(JSON.parse(manifest.toString('utf8')));
    if (pin !== null && pin !== release.version)
      throw new Error('Artifact version does not match pin');
    return { release, archive: () => Promise.resolve(join(local, 'arkvory-runtime.zip')) };
  }
  const { selected, from } = await selectRelease(root, pin, current);
  if (!selected) {
    if (!current) throw new Error('No release is offered for installation');
    return { release: current, archive: () => Promise.reject(new Error('Nothing to download')) };
  }
  return {
    release: selected.release,
    archive: async () => {
      const destination = inside(root, `download-${randomUUID()}.zip`);
      await from.download(selected.archiveUrl, destination, selected.release.archiveSha256);
      return destination;
    },
  };
}
export async function stage(root: string, source: Source): Promise<void> {
  const destination = inside(root, 'releases', source.release.version);
  if (await present(destination)) {
    await reuse(root, source, destination);
    return;
  }
  const archive = await verifiedArchive(source);
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
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
/** The archive of the selected release after its SHA-256 matched the release metadata. */
async function verifiedArchive(source: Source): Promise<string> {
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
  return archive;
}
/**
 * An existing releases/<version> is used only when it matches the verified archive of that
 * release entry for entry and byte for byte (ADR 0031): never by its name or its release.json.
 * A directory that differs stays untouched for inspection.
 */
async function reuse(root: string, source: Source, destination: string): Promise<void> {
  const differs = () =>
    new Error(
      `Existing release differs from its verified archive; move releases/${source.release.version} aside and run again`,
    );
  const installed = await jsonFile(join(destination, 'release.json'))
    .then(parseRelease)
    .catch(() => null);
  if (installed?.archiveSha256 !== source.release.archiveSha256) throw differs();
  const archive = await verifiedArchive(source);
  const reference = inside(root, 'releases', `.verify-${randomUUID()}`);
  try {
    await extractArchive(archive, reference);
    if (!(await sameTree(destination, reference, new Set(['release.json'])))) throw differs();
  } finally {
    // Only the fresh directory extracted above; rm does not follow links.
    await rm(reference, { recursive: true, force: true });
  }
}
async function readableTree(directory: string): Promise<void> {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await readableTree(path);
  }
  await syncDirectory(directory);
}

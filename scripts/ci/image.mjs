import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dependencies, dependency, pinnedDownload } from '../native-dependencies.mjs';
import { docker, exists } from './docker.mjs';

// GitHub ubuntu runners preinstall PowerShell 7; deployment gates parse the Windows installer
// scripts with it on Linux too. Hash from the release asset digest and release notes.
const powershell = [
  'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/powershell-7.6.6-linux-x64.tar.gz',
  'ddbc4a2d113bbd46d283cfedcbcd117a70caefd7673f41f2b4e0000badf103bc',
];

export const postgresImage =
  'postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636';

async function playwrightVersion(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const version = manifest.devDependencies?.playwright;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ''))
    throw new Error('package.json must pin an exact Playwright version for the CI image');
  return version;
}

/**
 * The tag is derived from everything that shapes the image, so an edited Dockerfile, runtime or
 * Playwright pin always rebuilds and an unchanged one is reused across runs.
 */
export async function linuxImage(root, { signal } = {}) {
  const dockerfile = resolve(root, 'scripts/ci/linux.Dockerfile');
  const nodeHash = dependencies.nodeLinux[1];
  const playwright = await playwrightVersion(root);
  const digest = createHash('sha256')
    .update(await readFile(dockerfile))
    .update(nodeHash)
    .update(powershell[1])
    .update(playwright)
    .digest('hex')
    .slice(0, 16);
  const tag = `arkvory-ci-linux:${digest}`;
  if (await exists('image', tag)) return tag;
  const context = await mkdtemp(join(tmpdir(), 'arkvory-ci-image-'));
  try {
    const cache = resolve(root, '.cache/native-downloads');
    await copyFile(await dependency('nodeLinux', cache), join(context, 'node.tar.xz'));
    await copyFile(
      await pinnedDownload('powershellLinux', powershell, cache),
      join(context, 'powershell.tar.gz'),
    );
    await copyFile(dockerfile, join(context, 'Dockerfile'));
    await docker(
      [
        'build',
        '--pull=false',
        '--build-arg',
        `NODE_SHA256=${nodeHash}`,
        '--build-arg',
        `POWERSHELL_SHA256=${powershell[1]}`,
        '--build-arg',
        `PLAYWRIGHT_VERSION=${playwright}`,
        '--label',
        'org.proanima.arkvory.ci=local',
        '--tag',
        tag,
        context,
      ],
      { signal },
    );
  } finally {
    await rm(context, { recursive: true, force: true });
  }
  return tag;
}

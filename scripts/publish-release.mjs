import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { releaseFiles, verifyReleaseFiles } from './release-files.mjs';
import { nativeFiles, verifyNativeFiles } from './native-files.mjs';

const version = process.env.ARKVORY_RELEASE_VERSION;
if (!/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(version ?? ''))
  throw Error('Invalid stable version');
if (
  process.env.GITHUB_REF !== 'refs/heads/main' ||
  process.env.GITHUB_REPOSITORY !== 'ProAnima/Arkvory'
)
  throw Error('Only the trusted main workflow may prepare a release');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (sha !== process.env.GITHUB_SHA) throw Error('Checkout differs from tested workflow commit');
const output = resolve('artifacts', version);
// Publishing has write permission but never builds or executes the supplied application artifact.
await verifyReleaseFiles(output, version, sha, nativeFiles);
await verifyNativeFiles(output, version, sha);
const token = process.env.GH_TOKEN;
if (!token) throw Error('Missing release token');
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw Error(`Release API failed: ${response.status}`);
  return response.json();
}
const base = 'https://api.github.com/repos/ProAnima/Arkvory';
const checks = await request(
  `${base}/actions/workflows/check.yml/runs?head_sha=${sha}&per_page=30`,
);
if (
  !checks.workflow_runs?.some(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === 'main' &&
      ['push', 'workflow_dispatch'].includes(run.event) &&
      run.conclusion === 'success',
  )
)
  throw Error(
    'The complete Windows/Linux merge gate must pass for this exact commit before release creation',
  );
await request(`${base}/git/refs`, {
  method: 'POST',
  body: JSON.stringify({ ref: `refs/tags/v${version}`, sha }),
});
const release = await request(`${base}/releases`, {
  method: 'POST',
  body: JSON.stringify({
    tag_name: `v${version}`,
    target_commitish: sha,
    name: `Arkvory ${version}`,
    draft: true,
    prerelease: false,
    // The signing key never reaches CI (ADR 0060): the draft is signed on the release workstation.
    body: `All release gates passed for this commit. Sign the draft on the release workstation before publishing: npm run release:sign -- sign-draft ${version}. Installations refuse unsigned releases; after publishing, approve the version in the hub.\n\nВсе release-гейты пройдены. Перед публикацией подпишите черновик на рабочей станции выпуска: npm run release:sign -- sign-draft ${version}. Установки не принимают неподписанные релизы; после публикации одобрите версию в хабе.`,
  }),
});
if (
  typeof release.upload_url !== 'string' ||
  !release.upload_url.startsWith('https://uploads.github.com/repos/ProAnima/Arkvory/')
)
  throw Error('Invalid asset upload URL');
for (const name of [...releaseFiles, 'release-checksums.json', ...nativeFiles]) {
  const path = join(output, name);
  await request(release.upload_url.split('{')[0] + `?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: createReadStream(path),
    duplex: 'half',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String((await stat(path)).size),
    },
  });
}
console.log(`Draft release prepared: ${release.html_url}`);

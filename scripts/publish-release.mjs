import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { releaseFiles, verifyReleaseFiles } from './release-files.mjs';

const version = process.env.DEPOT_RELEASE_VERSION;
if (!/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(version ?? ''))
  throw Error('Invalid stable version');
if (
  process.env.GITHUB_REF !== 'refs/heads/main' ||
  process.env.GITHUB_REPOSITORY !== 'ProAnima/Depot'
)
  throw Error('Only the trusted main workflow may prepare a release');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (sha !== process.env.GITHUB_SHA) throw Error('Checkout differs from tested workflow commit');
const output = resolve('artifacts', version);
// Publishing has write permission but never builds or executes the supplied application artifact.
await verifyReleaseFiles(output, version, sha);
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
const base = 'https://api.github.com/repos/ProAnima/Depot';
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
    name: `Depot ${version}`,
    draft: true,
    prerelease: false,
    body: 'All release gates passed for this commit. Review deployment notes and platform smoke evidence before publishing. Publishing makes this version eligible for opt-in automatic updates.\n\nВсе release-гейты пройдены. Перед публикацией проверьте инструкции развёртывания и результаты проверок платформ. Публикация разрешает установкам с включённым автообновлением перейти на эту версию.',
  }),
});
if (
  typeof release.upload_url !== 'string' ||
  !release.upload_url.startsWith('https://uploads.github.com/repos/ProAnima/Depot/')
)
  throw Error('Invalid asset upload URL');
for (const name of [...releaseFiles, 'release-checksums.json']) {
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

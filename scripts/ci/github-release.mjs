import { execFileSync, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { renderMarkdown } from './evidence.mjs';

export const repository = 'ProAnima/Arkvory';
const stable = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;

function run(file, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`${file} is unavailable: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure)
    throw new Error(`${file} ${args[0]} failed: ${(result.stderr || '').trim().slice(0, 300)}`);
  return { ok: result.status === 0, stdout: (result.stdout || '').trim() };
}

export function parseVersion(text) {
  const match = stable.exec(text ?? '');
  if (!match) throw new Error('Version must be a stable x.y.z without "v" (for example 1.2.3)');
  return match.slice(1).map(Number);
}

export function newerThan(version, tags) {
  const candidate = parseVersion(version);
  for (const tag of tags) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) continue;
    const existing = parseVersion(tag.slice(1));
    for (let index = 0; index < 3; index++) {
      if (candidate[index] > existing[index]) break;
      if (candidate[index] < existing[index] || index === 2) return false;
    }
  }
  return true;
}

function remoteProblems(root, version, commit, git) {
  const problems = [];
  git(['fetch', '--quiet', 'origin', 'main']);
  if (git(['rev-parse', 'origin/main']) !== commit)
    problems.push('Push main first: the draft must target a commit GitHub already has');
  if (!run('gh', ['auth', 'status'], { cwd: root, allowFailure: true }).ok)
    return [...problems, 'Sign in with `gh auth login` (repository write access)'];
  const repo = JSON.parse(
    run('gh', ['repo', 'view', repository, '--json', 'nameWithOwner,viewerPermission'], {
      cwd: root,
    }).stdout,
  );
  if (
    repo.nameWithOwner !== repository ||
    !['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission)
  )
    problems.push(`The signed-in GitHub account cannot create releases in ${repository}`);
  const tag = `v${version}`;
  const view = ['release', 'view', tag, '--repo', repository];
  if (run('gh', view, { cwd: root, allowFailure: true }).ok)
    problems.push(`Release ${tag} already exists (draft or published)`);
  if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]))
    problems.push(`Tag ${tag} already exists on origin`);
  const list = ['release', 'list', '--repo', repository, '--exclude-drafts', '--limit', '100'];
  const published = JSON.parse(run('gh', [...list, '--json', 'tagName'], { cwd: root }).stdout).map(
    (item) => item.tagName,
  );
  if (!newerThan(version, published))
    problems.push(`Version ${version} must be greater than every published release`);
  return problems;
}

/**
 * Everything a draft needs is checked before an hour of gates: the tag must target a commit
 * GitHub already has (pushed main), the account must be able to write releases, and the
 * version must be new and greater than every published release the updater could compare.
 * A rehearsal (`strict: false`) reports remote problems as warnings and never publishes.
 */
export async function releasePreconditions(root, version, output, { strict = true } = {}) {
  parseVersion(version);
  const git = (args) => run('git', args, { cwd: root }).stdout;
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main')
    throw new Error('Releases are cut from main; check out main');
  if (git(['status', '--porcelain'])) throw new Error('Commit or discard local changes first');
  const commit = git(['rev-parse', 'HEAD']);
  const warnings = remoteProblems(root, version, commit, git);
  if (strict && warnings.length) throw new Error(warnings.join('\n'));
  try {
    if ((await readdir(output)).length) throw new Error(`${output} must be empty`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { commit, tag: `v${version}`, warnings };
}

export function releaseNotes(version, evidence, acceptance) {
  return [
    'All release gates passed for this commit on the maintainer workstation (local CI). The release is signed (arkvory-release.json.sig, latest.json). Review deployment notes and platform evidence before publishing; after publishing, approve the version for a channel in the hub.',
    '',
    'Все release-гейты для этого commit пройдены локальным конвейером на машине сопровождающего. Релиз подписан (arkvory-release.json.sig, latest.json). Перед публикацией проверьте инструкции развёртывания и результаты проверок платформ; после публикации одобрите версию для канала в хабе.',
    '',
    `### Release gates (${version})`,
    '',
    renderMarkdown(evidence),
    '### Candidate acceptance',
    '',
    renderMarkdown(acceptance),
  ].join('\n');
}

/** Creates a draft only; GitHub creates the tag when a maintainer publishes it. */
export function createDraft(root, { tag, commit, version, notesFile, files }) {
  const args = [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--draft',
    '--target',
    commit,
    '--title',
    `Arkvory ${version}`,
    '--notes-file',
    notesFile,
    ...files,
  ];
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

export function draftCommand(details) {
  return ['gh', 'release', 'create', details.tag, '--draft', '--target', details.commit].join(' ');
}

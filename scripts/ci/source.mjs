import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function git(root, args, env = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env },
  }).trim();
}

/**
 * What the Linux lanes test. A clean tree is HEAD itself. With --allow-dirty the working tree,
 * including untracked files that .gitignore does not exclude, is captured as a commit object
 * through a temporary index: HEAD, the real index and the stash stay untouched. The temporary
 * ref only lets `git bundle` carry the object and is deleted by `release()`.
 */
export async function sourceSnapshot(root, dirty) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!dirty) return { commit: head, head, ref: 'HEAD', release: async () => {} };
  const folder = await mkdtemp(join(tmpdir(), 'arkvory-ci-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(folder, 'index') };
    git(root, ['read-tree', 'HEAD'], env);
    git(root, ['add', '-A'], env);
    const tree = git(root, ['write-tree'], env);
    const commit = git(root, ['commit-tree', tree, '-p', head, '-m', 'local CI working tree'], {
      ...env,
      GIT_AUTHOR_NAME: 'Arkvory local CI',
      GIT_AUTHOR_EMAIL: 'local-ci@invalid',
      GIT_COMMITTER_NAME: 'Arkvory local CI',
      GIT_COMMITTER_EMAIL: 'local-ci@invalid',
    });
    const ref = `refs/arkvory-ci/${commit}`;
    git(root, ['update-ref', ref, commit]);
    return {
      commit,
      head,
      ref,
      release: async () => {
        git(root, ['update-ref', '-d', ref]);
      },
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

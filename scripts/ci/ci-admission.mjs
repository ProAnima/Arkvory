import { spawnSync } from 'node:child_process';
import { admitCommit, checkWorkflow } from '../release-admission.mjs';
import { gapJobs, workflowJobs } from './ci-jobs.mjs';
import { notExecuted } from './lanes.mjs';

/** GitHub REST through the signed-in `gh` CLI of the release workstation. */
export function ghRequest(root) {
  return async (path) => {
    const result = spawnSync('gh', ['api', path], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw new Error(`gh is unavailable: ${result.error.message}`);
    if (result.status !== 0)
      throw new Error(
        `gh api ${path.split('?')[0]} failed: ${(result.stderr || '').trim().slice(0, 300)}`,
      );
    return JSON.parse(result.stdout);
  };
}

/**
 * GitHub CI coverage of the local gaps for `commit`. The required jobs are derived from the
 * committed check.yml: every job executing a gap's gate on its CI platform, besides the merge
 * gate and both large transfers. A real release (`strict`) fails closed on any problem,
 * including an unreachable GitHub; a rehearsal records the problems and goes on.
 */
export async function ciAdmission(commit, { workflow, registry, source, strict }) {
  const gaps = notExecuted.filter((entry) => entry.kind === 'gap');
  const { coverage, problems } = gapJobs(workflowJobs(workflow, registry), gaps);
  const required = [...new Set(coverage.flatMap((item) => item.jobs))];
  let result;
  try {
    result = problems.length ? { problems } : await admitCommit(commit, { ...source, required });
  } catch (error) {
    if (strict) throw error;
    const reason = error instanceof Error ? error.message : 'unknown error';
    return {
      status: 'unavailable',
      commit,
      coverage,
      problems: [`GitHub CI unavailable: ${reason}`],
    };
  }
  const ci = {
    status: result.run ? 'passed' : 'failed',
    commit,
    workflow: checkWorkflow,
    ...(result.run ? { run: result.run } : {}),
    coverage,
    problems: result.problems,
  };
  if (strict && ci.status !== 'passed')
    throw new Error(
      `GitHub CI does not prove the local gaps for ${commit}:\n${ci.problems.join('\n')}`,
    );
  return ci;
}

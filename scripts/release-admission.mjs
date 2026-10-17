import { fileURLToPath } from 'node:url';

/**
 * Release admission (ADR 0053, addendum 2026-10-17): a commit may become a release only after the
 * complete `Arkvory gates` workflow (check.yml) passed for that exact commit on main. On push and
 * merge-queue events the merge gate also requires both 5 GiB transfers, so a successful run
 * proves the whole release profile in CI. The module has no dependencies: the release workflow
 * runs it before installing anything, and the publisher may not install dependencies at all.
 */
export const repository = 'ProAnima/Arkvory';
export const checkWorkflow = 'check.yml';
export const mergeGateJob = 'Arkvory merge gate';
export const largeJobs = ['Release 5 GiB (large-full)', 'Release 5 GiB (large-multipart)'];

/**
 * Only main counts: a push to main or a merge-queue group targeting main. Pull requests,
 * schedules and manual runs are excluded; a manual run may skip the large transfers.
 */
export function trustedRun(run, sha) {
  const branch = typeof run.head_branch === 'string' ? run.head_branch : '';
  return (
    run.head_sha === sha &&
    run.status === 'completed' &&
    ((run.event === 'push' && branch === 'main') ||
      (run.event === 'merge_group' && branch.startsWith('gh-readonly-queue/main/')))
  );
}

/** Problems of one trusted run; `jobs` are the latest attempt of each job of that run. */
export function runProblems(run, jobs, required = []) {
  const problems = [];
  if (run.conclusion !== 'success')
    problems.push(`${checkWorkflow} run ${run.id} concluded ${run.conclusion ?? 'without result'}`);
  for (const name of [...new Set([mergeGateJob, ...largeJobs, ...required])]) {
    const matching = jobs.filter((job) => job.name === name);
    if (matching.length === 0) problems.push(`${name}: missing in run ${run.id}`);
    for (const job of matching)
      if (job.conclusion !== 'success')
        problems.push(`${name}: ${job.conclusion ?? job.status ?? 'unknown'} in run ${run.id}`);
  }
  return problems;
}

/**
 * Finds the newest trusted run of `sha` whose merge gate, large transfers and `required` jobs
 * all succeeded. Runs for any other commit are ignored, never borrowed. Fails closed: when no
 * run qualifies the result carries the reasons and no run.
 */
export async function admitCommit(sha, { listRuns, listJobs, required = [] }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Release admission needs a full commit');
  const runs = (await listRuns(sha))
    .filter((run) => trustedRun(run, sha))
    .sort((a, b) => b.id - a.id);
  if (runs.length === 0)
    return {
      problems: [
        `No completed ${checkWorkflow} run on push or merge queue to main for ${sha}; push main and wait for CI`,
      ],
    };
  const problems = [];
  for (const run of runs) {
    const found = runProblems(run, await listJobs(run), required);
    if (found.length === 0)
      return {
        run: {
          id: run.id,
          url: run.html_url,
          event: run.event,
          branch: run.head_branch,
          attempt: run.run_attempt ?? 1,
        },
        problems: [],
      };
    problems.push(...found);
  }
  return { problems };
}

/** GitHub REST client for admission; `request(path)` returns parsed JSON. */
export function githubSource(request) {
  return {
    listRuns: async (sha) =>
      (
        await request(
          `/repos/${repository}/actions/workflows/${checkWorkflow}/runs?head_sha=${sha}&status=completed&per_page=100`,
        )
      ).workflow_runs ?? [],
    listJobs: async (run) => {
      const page = await request(
        `/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      );
      const jobs = page.jobs ?? [];
      // A truncated job list could hide a failed job; refuse instead of paging silently.
      if (page.total_count !== jobs.length) throw new Error(`Run ${run.id}: incomplete job list`);
      return jobs;
    },
  };
}

export function tokenRequest(token) {
  if (!token) throw new Error('Missing GitHub token for release admission');
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`GitHub API ${path.split('?')[0]}: ${response.status}`);
    return response.json();
  };
}

/** The release workflow's first job: the exact workflow commit must have passed the merge gate. */
async function main() {
  const sha = process.env.GITHUB_SHA ?? '';
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== repository)
    throw new Error('Only the trusted main workflow may admit a release');
  const result = await admitCommit(sha, githubSource(tokenRequest(process.env.GH_TOKEN)));
  if (!result.run) throw new Error(`Release refused for ${sha}:\n${result.problems.join('\n')}`);
  process.stdout.write(`Release admitted: ${checkWorkflow} run ${result.run.url}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

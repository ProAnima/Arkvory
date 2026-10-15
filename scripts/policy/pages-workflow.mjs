import { parse } from 'yaml';
import { inspectRunnerImages } from './runners.mjs';

const pinnedAction = /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/;
/**
 * Main only, and only once the owner turned publishing on (the repository variable ARKVORY_PAGES):
 * a site under the project's name is a decision, not a side effect of a push.
 */
const trustedMain = "github.ref == 'refs/heads/main' && vars.ARKVORY_PAGES == 'true'";

/**
 * The documentation workflow publishes a website under the project's name. Only main is built;
 * only the deploy job, which runs no repository code, can write Pages; the build passes the
 * same `docs` gate as CI; every action is pinned and every job bounded.
 */
export function inspectPagesWorkflow(text) {
  const errors = [],
    workflow = parse(text),
    jobs = workflow.jobs ?? {};
  if (Object.keys(jobs).sort().join() !== 'build,deploy')
    errors.push('Pages: unexpected jobs require an explicit policy change');
  if (
    Object.keys(workflow.on ?? {})
      .sort()
      .join() !== 'push,workflow_dispatch'
  )
    errors.push('Pages: only pushes and manual runs may publish');
  if (JSON.stringify(workflow.on?.push) !== JSON.stringify({ branches: ['main'] }))
    errors.push('Pages: only main is published');
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' }))
    errors.push('Pages: the default token must be contents:read only');
  const { build, deploy } = jobs;
  for (const [name, job] of Object.entries(jobs)) {
    if (job.if !== trustedMain) errors.push(`Pages ${name}: trusted main required`);
    if (
      !Number.isInteger(job['timeout-minutes']) ||
      job['timeout-minutes'] < 1 ||
      job['timeout-minutes'] > 45
    )
      errors.push(`Pages ${name}: bounded job timeout required`);
    if (job['continue-on-error']) errors.push(`Pages ${name}: continue-on-error is forbidden`);
    for (const step of job.steps ?? []) {
      if (step['continue-on-error'])
        errors.push(`Pages ${name}: step continue-on-error is forbidden`);
      if (step.uses && !pinnedAction.test(step.uses))
        errors.push(`Pages ${name}: actions must use immutable full SHAs`);
      if (
        step.uses?.startsWith('actions/checkout@') &&
        step.with?.['persist-credentials'] !== false
      )
        errors.push(`Pages ${name}: checkout credentials must not persist`);
    }
  }
  if (build?.permissions) errors.push('Pages build: the build may not elevate permissions');
  if (
    !build?.steps?.some((step) => step.run === 'npm run gate -- docs' && !Object.hasOwn(step, 'if'))
  )
    errors.push('Pages build: the site must pass the docs gate');
  if (
    JSON.stringify(deploy?.permissions) !== JSON.stringify({ pages: 'write', 'id-token': 'write' })
  )
    errors.push('Pages deploy: exactly pages:write and id-token:write');
  if (deploy?.needs !== 'build') errors.push('Pages deploy: publishes only what the build made');
  if (
    (deploy?.steps ?? []).length !== 1 ||
    !deploy.steps[0].uses?.startsWith('actions/deploy-pages@')
  )
    errors.push('Pages deploy: runs nothing but the deploy action');
  errors.push(...inspectRunnerImages(jobs));
  return errors;
}

import { parse } from 'yaml';
import { planGates } from './inventory.mjs';

const archiveCondition = "${{ always() && vars.ARKVORY_UPLOAD_ARTIFACTS == 'true' }}";

export function inspectWorkflow(text, registry) {
  const errors = [],
    workflow = parse(text),
    jobs = workflow.jobs;
  for (const trigger of ['push', 'pull_request', 'merge_group', 'workflow_dispatch', 'schedule'])
    if (!Object.hasOwn(workflow.on, trigger)) errors.push(`CI missing trigger: ${trigger}`);
  if (Object.hasOwn(workflow.on, 'pull_request_target'))
    errors.push('CI must not execute untrusted changes with pull_request_target');
  if (workflow.permissions?.contents !== 'read' || Object.keys(workflow.permissions).length !== 1)
    errors.push('CI default token must be contents:read only');
  if (
    JSON.stringify(jobs.check?.strategy?.matrix?.os) !==
    JSON.stringify(['ubuntu-22.04', 'ubuntu-24.04', 'windows-2022', 'windows-2025'])
  )
    errors.push('CI must cover all supported native platforms');
  for (const [name, job] of Object.entries(jobs)) {
    if (
      job.permissions &&
      (job.permissions.contents !== 'read' || Object.keys(job.permissions).length !== 1)
    )
      errors.push(`${name}: job token must not elevate workflow permissions`);
    if (
      !Number.isInteger(job['timeout-minutes']) ||
      job['timeout-minutes'] > 45 ||
      job['timeout-minutes'] < 1
    )
      errors.push(`${name}: bounded job timeout required`);
    if (job['continue-on-error']) errors.push(`${name}: continue-on-error is forbidden`);
    for (const step of job.steps ?? []) {
      if (step['continue-on-error']) errors.push(`${name}: step continue-on-error is forbidden`);
      if (step.uses && !/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(step.uses))
        errors.push(`${name}: actions must use immutable full SHAs`);
      if (step.uses?.startsWith('actions/upload-artifact@') && step.if !== archiveCondition)
        errors.push(`${name}: artifact archives must be explicitly enabled`);
      if (
        step.uses?.startsWith('actions/checkout@') &&
        step.with?.['persist-credentials'] !== false
      )
        errors.push(`${name}: checkout credentials must not persist`);
      if (
        step.run &&
        step.run !== 'npm run test:browser:install' &&
        /node\s+.*tests\/|npm\s+(?:run\s+)?test\b|--test\b/.test(step.run)
      )
        errors.push(`${name}: invoke tests through npm run gate`);
    }
  }
  const required = Object.keys(jobs).filter((name) => name !== 'verdict');
  if (
    jobs.verdict?.if !== '${{ always() }}' ||
    !Array.isArray(jobs.verdict?.needs) ||
    required.some((j) => !jobs.verdict?.needs?.includes(j))
  )
    errors.push('Aggregate verdict must always inspect every lane');
  for (const [name, profile] of [
    ['check', 'quick'],
    ['integration', 'integration'],
    ['browser', 'browser'],
    ['security', 'security'],
    ['large', '${{ matrix.gate }}'],
  ]) {
    if (
      !jobs[name]?.steps?.some(
        (s) =>
          s.run?.startsWith('npm run gate -- ') &&
          (s.run === `npm run gate -- ${profile}` ||
            s.run.slice(16).split(' ').includes(profile)) &&
          !Object.hasOwn(s, 'if'),
      )
    )
      errors.push(`CI ${name} must execute gate ${profile}`);
    if (
      !jobs[name]?.steps?.some(
        (s) => s.run === 'node scripts/ci-report.mjs' && s.if === '${{ always() }}',
      )
    )
      errors.push(`CI ${name} must publish its gate report even on failure`);
  }
  for (const name of required.filter((name) => name !== 'large'))
    if (jobs[name] && Object.hasOwn(jobs[name], 'if'))
      errors.push(`Mandatory CI lane ${name} cannot be conditional`);
  for (const trigger of ['push', 'pull_request'])
    if (workflow.on[trigger]?.paths || workflow.on[trigger]?.['paths-ignore'])
      errors.push('Required workflows must not silently skip changed paths');
  errors.push(...inspectVerdictWiring(jobs));
  errors.push(...inspectLargeMatrix(jobs.large));
  if (registry) errors.push(...inspectCoverage(jobs, registry));
  return errors;
}

function inspectCoverage(jobs, registry) {
  const errors = [],
    executed = new Set(),
    merge = new Set(planGates(registry, ['verify']));
  for (const [name, job] of Object.entries(jobs))
    for (const step of job.steps ?? []) {
      const match = /^npm run gate -- ([a-z-]+(?: [a-z-]+)*)$/.exec(step.run ?? '');
      const selected =
        name === 'large' &&
        step.run === 'npm run gate -- ${{ matrix.gate }}' &&
        inspectLargeMatrix(job).length === 0
          ? job.strategy.matrix.gate
          : match?.[1].split(' ');
      if (!selected || Object.hasOwn(step, 'if')) continue;
      for (const task of planGates(registry, selected)) {
        executed.add(task);
        if (name !== 'large' && !merge.has(task))
          errors.push(`Mandatory CI gate missing from verify: ${task}`);
      }
    }
  for (const task of Object.keys(registry.tasks))
    if (!executed.has(task)) errors.push(`Gate absent from CI: ${task}`);
  return errors;
}

function inspectLargeMatrix(job) {
  // Exact coverage prevents include/exclude or an extra axis from silently removing a scenario.
  if (
    JSON.stringify(job?.strategy?.matrix) !==
      JSON.stringify({ gate: ['large-full', 'large-multipart'] }) ||
    job?.strategy?.['fail-fast'] !== false ||
    job?.strategy?.['max-parallel'] !== 2
  )
    return ['Large transfer matrix must execute both scenarios on independent runners'];
  return [];
}

function inspectVerdictWiring(jobs) {
  const release =
    "${{ github.event_name == 'push' || github.event_name == 'merge_group' || github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.large_transfers) }}";
  const errors = [];
  if (jobs.large?.if !== release)
    errors.push('Large transfers must run for every release tag/manual request');
  const step = jobs.verdict?.steps?.find((s) => s.run === 'node scripts/ci-verdict.mjs');
  if (
    !step ||
    Object.hasOwn(step, 'if') ||
    step.env?.ARKVORY_CI_NEEDS !== '${{ toJSON(needs) }}' ||
    step.env?.ARKVORY_RELEASE_REQUIRED !== release
  )
    errors.push('Aggregate verdict must receive actual job results and release requirement');
  return errors;
}

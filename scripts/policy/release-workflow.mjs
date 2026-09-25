import { parse } from 'yaml';

export function inspectReleaseWorkflow(text) {
  const workflow = parse(text),
    errors = [];
  const { build, acceptance, publish } = workflow.jobs ?? {};
  if (
    Object.keys(workflow.jobs ?? {})
      .sort()
      .join() !== 'acceptance,build,native,publish'
  )
    errors.push('Unexpected release jobs require an explicit policy change');
  if (Object.keys(workflow.on ?? {}).join() !== 'workflow_dispatch')
    errors.push('Release must be manual');
  if (workflow.permissions?.contents !== 'read' || Object.keys(workflow.permissions).length !== 1)
    errors.push('Release default permission must be read-only');
  for (const name of ['build', 'publish'])
    if (workflow.jobs?.[name]?.if !== "github.ref == 'refs/heads/main'")
      errors.push(`${name}: trusted main required`);
  if (build?.permissions || acceptance?.permissions || workflow.jobs?.native?.permissions)
    errors.push('Build and acceptance may not elevate permissions');
  if (
    JSON.stringify(publish?.permissions) !== JSON.stringify({ contents: 'write', actions: 'read' })
  )
    errors.push('Only publishing receives the bounded release token');
  if (
    acceptance?.needs !== 'build' ||
    JSON.stringify(publish?.needs) !== JSON.stringify(['build', 'acceptance', 'native'])
  )
    errors.push('Publishing requires artifact acceptance');
  const platforms = ['ubuntu-22.04', 'ubuntu-24.04', 'windows-2022', 'windows-2025'];
  if (
    JSON.stringify(acceptance?.strategy?.matrix?.os) !== JSON.stringify(platforms) ||
    acceptance?.strategy?.['fail-fast'] !== false
  )
    errors.push('All supported release platforms must be checked');
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    if (
      job['continue-on-error'] ||
      !Number.isInteger(job['timeout-minutes']) ||
      job['timeout-minutes'] > 45
    )
      errors.push(`${name}: bounded blocking job required`);
    for (const step of job.steps ?? []) {
      if (step['continue-on-error']) errors.push(`${name}: failure cannot be ignored`);
      if (step.uses && !/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(step.uses))
        errors.push(`${name}: immutable action required`);
      if (
        step.uses?.startsWith('actions/checkout@') &&
        step.with?.['persist-credentials'] !== false
      )
        errors.push(`${name}: checkout credentials must not persist`);
      if (name === 'publish' && step.run && step.run !== 'node scripts/publish-release.mjs')
        errors.push('Publishing cannot install dependencies, build or execute candidate code');
    }
  }
  const steps = build?.steps ?? [];
  const gate = steps.findIndex(
    (s) => s.run === 'npm run gate -- release' && !Object.hasOwn(s, 'if'),
  );
  const packaging = steps.findIndex(
    (s) =>
      s.run === 'npm run release:package -- "$DEPOT_RELEASE_VERSION"' && !Object.hasOwn(s, 'if'),
  );
  const upload = steps.findIndex(
    (s) =>
      s.uses?.startsWith('actions/upload-artifact@') &&
      !Object.hasOwn(s, 'if') &&
      s.with?.['if-no-files-found'] === 'error',
  );
  if (gate < 0 || packaging <= gate || upload <= packaging)
    errors.push('Build, test and required artifact transfer must be ordered');
  if (
    !acceptance?.steps?.some(
      (s) => s.run === 'npm run gate -- deployment deployment-services' && !Object.hasOwn(s, 'if'),
    ) ||
    !acceptance?.steps?.some(
      (s) => s.run === 'npm run gate -- deployment-containers' && s.if === "runner.os == 'Linux'",
    )
  )
    errors.push('Release artifact acceptance cannot be removed');
  if (acceptance?.env?.DEPOT_RELEASE_ARTIFACT !== '${{ github.workspace }}/candidate')
    errors.push('Acceptance must use the supplied artifact');
  for (const [name, path] of [
    ['acceptance', 'candidate'],
    ['native', 'candidate'],
    ['publish', 'artifacts/${{ inputs.version }}'],
  ])
    if (
      !workflow.jobs?.[name]?.steps?.some(
        (s) =>
          s.uses?.startsWith('actions/download-artifact@') &&
          !Object.hasOwn(s, 'if') &&
          s.with?.name === 'release-candidate' &&
          s.with?.path === path &&
          !s.with?.['run-id'],
      )
    )
      errors.push(`${name}: current-run candidate required`);
  errors.push(...inspectNative(workflow));
  return errors;
}

function inspectNative(workflow) {
  const errors = [];
  const { native, publish } = workflow.jobs ?? {};
  if (
    native?.needs !== 'build' ||
    native?.env?.DEPOT_RELEASE_ARTIFACT !== '${{ github.workspace }}/candidate' ||
    native?.env?.DEPOT_NATIVE_ARTIFACT !== '${{ github.workspace }}/native-candidate' ||
    Object.hasOwn(native ?? {}, 'if') ||
    JSON.stringify(native?.strategy?.matrix?.os) !==
      JSON.stringify(['ubuntu-24.04', 'windows-2022']) ||
    !native?.steps?.some(
      (s) => s.run === 'npm run gate -- native-install' && !Object.hasOwn(s, 'if'),
    ) ||
    !native?.steps?.some(
      (s) =>
        s.uses?.startsWith('actions/upload-artifact@') &&
        s.with?.name === 'native-${{ matrix.os }}' &&
        s.with?.['if-no-files-found'] === 'error' &&
        !Object.hasOwn(s, 'if'),
    )
  )
    errors.push('Native packages require blocking installation acceptance before upload');
  if (
    !publish?.steps?.some(
      (s) =>
        s.uses?.startsWith('actions/download-artifact@') &&
        s.with?.pattern === 'native-*' &&
        s.with?.['merge-multiple'] === true &&
        s.with?.path === 'artifacts/${{ inputs.version }}' &&
        !s.with?.['run-id'] &&
        !Object.hasOwn(s, 'if'),
    )
  )
    errors.push('Publish requires tested native packages from this run');
  return errors;
}

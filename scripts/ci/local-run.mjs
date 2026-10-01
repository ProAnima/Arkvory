import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { release, type } from 'node:os';
import { planLanes } from './lanes.mjs';
import { laneResult, readReports, renderMarkdown, summarize } from './evidence.mjs';
import { docker } from './docker.mjs';
import { linuxImage } from './image.mjs';
import { runLinuxLane } from './linux-lane.mjs';
import { runWindowsLane } from './windows-lane.mjs';
import { sourceSnapshot } from './source.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

export function treeState(root) {
  return { commit: git(root, ['rev-parse', 'HEAD']), dirty: git(root, ['status', '--porcelain']) };
}

async function host() {
  return {
    os: `${type()} ${release()}`,
    node: process.version,
    docker: await docker(['version', '--format', '{{.Server.Version}}'], { capture: true }),
  };
}

/**
 * Executes the planned lanes one after another (sequential runs keep timing-sensitive suites
 * stable on one workstation) and always writes evidence, including for failed lanes.
 * `laneOptions[name]` adds environment, inputs and outputs for that lane (release acceptance).
 */
export async function runLocalCi(root, options) {
  const { profile, laneNames, allowDirty = false, keep = false, signal } = options;
  const { commit, dirty } = treeState(root);
  if (dirty && !allowDirty)
    throw new Error('Working tree has uncommitted changes; commit them or pass --allow-dirty');
  if (process.platform !== 'win32' && laneNames?.includes('windows'))
    throw new Error('The windows lane runs only on a Windows host');
  // Release acceptance replaces a lane's gate list to exercise the packaged candidate.
  const plan = planLanes(profile, laneNames ?? defaultLanes()).map((lane) => ({
    ...lane,
    gates: options.laneOptions?.[lane.name]?.gates ?? lane.gates,
  }));
  const startedAt = new Date().toISOString();
  const evidenceRoot = resolve(
    root,
    'test-results/local-ci',
    `${commit}-${options.label ?? profile}`,
  );
  const image = plan.some((lane) => lane.platform === 'linux')
    ? await linuxImage(root, { signal })
    : undefined;
  const source = await sourceSnapshot(root, dirty.length > 0);
  const results = [];
  try {
    for (const lane of plan) {
      results.push(await runLane(root, lane, { ...options, image, source, evidenceRoot, keep }));
      if (signal?.aborted) break;
    }
  } finally {
    await source.release();
  }
  const evidence = summarize({
    profile,
    commit,
    ...(source.commit !== commit ? { snapshot: source.commit } : {}),
    dirty: dirty.length > 0,
    host: await host(),
    lanes: results,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await writeFile(join(evidenceRoot, 'evidence.md'), renderMarkdown(evidence));
  return { evidence, folder: evidenceRoot };
}

async function runLane(root, lane, options) {
  const { image, source, evidenceRoot, keep, signal } = options;
  process.stdout.write(`
Local CI lane: ${lane.name} (${lane.gates.join(', ')})
`);
  const folder = join(evidenceRoot, lane.name);
  // Reports from an earlier run of the same commit must not leak into this lane's verdict.
  await rm(folder, { recursive: true, force: true });
  const extra = options.laneOptions?.[lane.name] ?? {};
  // The host lane tests the working tree at HEAD; container lanes test the snapshot commit.
  const failure =
    lane.platform === 'win32'
      ? await runWindowsLane(root, lane, { results: folder, signal, env: extra.env })
      : await runLinuxLane(root, lane, { ...extra, image, source, results: folder, signal, keep });
  const expected = lane.platform === 'win32' ? source.head : source.commit;
  return laneResult(lane, await readReports(folder), failure, expected);
}

export function defaultLanes() {
  return process.platform === 'win32'
    ? ['windows', 'linux', 'linux-system']
    : ['linux', 'linux-system'];
}

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { lanes as catalog, notExecuted } from './lanes.mjs';

const statuses = ['passed', 'failed', 'not_run', 'running'];

/** Gate reports are produced by scripts/gates.mjs; anything else in the folder is rejected. */
export async function readReports(folder) {
  const result = [];
  let names = [];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names) {
    const path = join(folder, name);
    if ((await stat(path)).size > 1024 * 1024) throw new Error(`Gate report too large: ${name}`);
    const report = JSON.parse(await readFile(path, 'utf8'));
    if (
      typeof report.commit !== 'string' ||
      !['passed', 'failed'].includes(report.status) ||
      !Array.isArray(report.tasks) ||
      report.tasks.some((task) => typeof task.name !== 'string' || !statuses.includes(task.status))
    )
      throw new Error(`Invalid gate report: ${name}`);
    result.push(report);
  }
  return result;
}

function bounded(text) {
  return String(text).replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * A lane passes only when it raised no error and every planned gate passed in a report for the
 * expected commit. Missing reports never count as success. A dirty tree is recorded, not hidden:
 * it keeps the run useful during development but makes the evidence unusable for a release.
 */
export function laneResult(lane, reports, failure, commit) {
  const gates = new Map();
  for (const report of reports)
    for (const task of report.tasks)
      gates.set(task.name, {
        name: task.name,
        status: report.commit === commit ? task.status : 'failed',
        startedAt: task.startedAt ?? null,
        finishedAt: task.finishedAt ?? null,
      });
  const missing = lane.gates.filter((gate) => gates.get(gate)?.status !== 'passed');
  const dirty = reports.some((report) => report.dirty === true);
  const passed = !failure && missing.length === 0 && reports.length > 0;
  return {
    name: lane.name,
    environment: lane.environment,
    platform: lane.platform,
    planned: lane.gates,
    status: passed ? 'passed' : 'failed',
    gates: [...gates.values()],
    ...(missing.length ? { missing } : {}),
    ...(dirty ? { dirty: true } : {}),
    ...(failure ? { error: bounded(failure.message) } : {}),
  };
}

export function summarize(input) {
  const { profile, commit, snapshot, dirty, host, lanes, startedAt, finishedAt } = input;
  const complete = lanes.length > 0 && lanes.every((lane) => lane.status === 'passed');
  const status = complete ? 'passed' : 'failed';
  const dirtyRun = dirty || lanes.some((lane) => lane.dirty === true);
  return {
    format: 1,
    kind: 'arkvory-local-ci',
    profile,
    commit,
    // With --allow-dirty the Linux lanes test this working-tree commit object instead of HEAD.
    ...(snapshot ? { snapshot } : {}),
    dirty: dirtyRun,
    host,
    startedAt,
    finishedAt,
    status,
    // Releases need every lane of the release profile on a clean, committed tree.
    releasable:
      status === 'passed' &&
      !dirtyRun &&
      profile === 'release' &&
      Object.keys(catalog).every((name) => lanes.some((lane) => lane.name === name)),
    lanes,
    gaps: notExecuted.filter((entry) => entry.kind === 'gap'),
    covered: notExecuted.filter((entry) => entry.kind === 'covered'),
  };
}

export function renderMarkdown(evidence) {
  const lines = [
    `## Arkvory local CI: ${evidence.status.toUpperCase()}`,
    '',
    `Profile \`${evidence.profile}\`, commit \`${evidence.commit}\`${evidence.dirty ? ' (dirty tree)' : ''}.`,
    `Host: ${evidence.host.os}, Node ${evidence.host.node}, Docker ${evidence.host.docker}.`,
    '',
    '| Lane | Environment | Status | Gates |',
    '| --- | --- | --- | --- |',
  ];
  for (const lane of evidence.lanes)
    lines.push(
      `| ${lane.name} | ${lane.environment} | ${lane.status} | ${lane.planned.join(', ')} |`,
    );
  for (const lane of evidence.lanes.filter((item) => item.status !== 'passed'))
    lines.push(
      '',
      `${lane.name}: ${lane.missing ? `not passed: ${lane.missing.join(', ')}. ` : ''}${lane.error ?? ''}`,
    );
  lines.push('', 'Not executed locally:');
  for (const gap of evidence.gaps) lines.push(`- ${gap.gate} (${gap.platform}): ${gap.reason}`);
  lines.push('', 'Covered by another lane:');
  for (const item of evidence.covered)
    lines.push(`- ${item.gate} (${item.platform}): ${item.reason}`);
  return lines.join('\n') + '\n';
}

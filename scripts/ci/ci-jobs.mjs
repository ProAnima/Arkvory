import { parse } from 'yaml';
import { planGates } from '../policy/inventory.mjs';

const platformOf = (runner) =>
  /^windows-/.test(runner) ? 'win32' : /^ubuntu-/.test(runner) ? 'linux' : undefined;

function substitute(text, values) {
  return String(text).replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

function combinations(matrix) {
  let result = [{}];
  for (const [key, values] of Object.entries(matrix ?? {})) {
    // `include`/`exclude` would change job names in ways this expansion does not model.
    if (!Array.isArray(values)) throw new Error(`Unsupported matrix entry: ${key}`);
    result = result.flatMap((base) => values.map((value) => ({ ...base, [key]: value })));
  }
  return result;
}

/** A step runs on a platform unless its condition names the other runner OS. */
function stepRuns(step, platform) {
  if (!Object.hasOwn(step, 'if')) return true;
  if (step.if === "runner.os == 'Linux'") return platform === 'linux';
  if (step.if === "runner.os == 'Windows'") return platform === 'win32';
  return false;
}

/**
 * Expands check.yml into concrete jobs as GitHub names them: matrix values substituted into the
 * job name, runner and gate command. Conditional gate steps other than a runner OS guard do not
 * count as executed, so a disabled step can never cover a release gap.
 */
export function workflowJobs(text, registry) {
  const workflow = parse(text);
  const result = [];
  for (const [id, job] of Object.entries(workflow.jobs ?? {}))
    for (const values of combinations(job.strategy?.matrix)) {
      const platform = platformOf(substitute(job['runs-on'], values));
      const gates = new Set();
      for (const step of job.steps ?? []) {
        const match = /^npm run gate -- (.+)$/.exec(substitute(step.run ?? '', values));
        if (match && platform && stepRuns(step, platform))
          for (const gate of planGates(registry, match[1].split(' '))) gates.add(gate);
      }
      result.push({ id, name: substitute(job.name ?? id, values), platform, gates: [...gates] });
    }
  return result;
}

/**
 * For each local gap, the CI jobs that execute that gate on the platform where CI covers it
 * (`ci` of the gap, by default the gap's own platform). Every one of them must succeed in the
 * admitted run; a gap no job executes is a problem, never an implicit pass.
 */
export function gapJobs(jobs, gaps) {
  const coverage = [];
  const problems = [];
  for (const gap of gaps) {
    const platform = gap.ci ?? gap.platform;
    const names = jobs
      .filter((job) => job.platform === platform && job.gates.includes(gap.gate))
      .map((job) => job.name);
    if (names.length === 0)
      problems.push(`${gap.gate} (${gap.platform}): no CI job on ${platform}`);
    coverage.push({ gate: gap.gate, platform: gap.platform, ciPlatform: platform, jobs: names });
  }
  return { coverage, problems };
}

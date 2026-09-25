import { inspectWorkflow } from './policy/workflow.mjs';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { analyzeSource, inspectExceptions } from './policy/source.mjs';
import { filesUnder, planGates, testInventory, inspectWorkspaces } from './policy/inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const policy = await json('config/architecture.json'),
  exceptions = await json('config/architecture-exceptions.json'),
  gates = await json('config/gates.json');
const analyses = new Map(),
  problems = [];
for (const unit of policy.units)
  for (const file of await filesUnder(root, unit.path + '/src')) {
    if (!file.endsWith('.ts')) {
      problems.push(`Unvalidated source extension: ${file}`);
      continue;
    }
    analyses.set(file, analyzeSource(file, await readFile(resolve(root, file), 'utf8')));
  }
for (const folder of ['tests', 'scripts'])
  for (const file of await filesUnder(root, folder))
    if (file.endsWith('.mjs'))
      analyses.set(file, analyzeSource(file, await readFile(resolve(root, file), 'utf8')));
const production = new Map([...analyses].filter(([file]) => !file.startsWith('tests/')));
problems.push(...inspectExceptions(production, policy, exceptions, Date.now()));
for (const a of analyses.values()) problems.push(...a.problems);
for (const e of exceptions)
  for (const file of [e.decision, ...(e.tests ?? [])]) {
    if (!/^(docs\/adr\/|tests\/)[a-zA-Z0-9_./-]+$/.test(file) || file.includes('..')) {
      problems.push(`${e.id}: invalid evidence path`);
      continue;
    }
    try {
      await access(resolve(root, file));
    } catch {
      problems.push(`${e.id}: missing evidence ${file}`);
    }
  }
problems.push(...(await inspectWorkspaces(root, policy)), ...testInventory(gates, analyses));
planGates(gates, Object.keys(gates.tasks));
const releasePlan = planGates(gates, ['release']);
for (const task of Object.keys(gates.tasks))
  if (!releasePlan.includes(task)) problems.push(`Gate outside release profile: ${task}`);
problems.push(
  ...inspectWorkflow(await readFile(resolve(root, '.github/workflows/check.yml'), 'utf8'), gates),
);
for (const [profile, required] of [
  ['verify', gates.mergeTasks],
  ['release', gates.releaseTasks],
]) {
  const plan = planGates(gates, [profile]);
  if (required.some((task) => !plan.includes(task)))
    problems.push(`Profile ${profile} omits required gates`);
}
await mkdir(resolve(root, 'test-results'), { recursive: true });
await writeFile(
  resolve(root, 'test-results/architecture.json'),
  JSON.stringify(
    {
      limits: policy.limits,
      exceptions,
      problems,
      metrics: [...production.values()].flatMap((a) => a.metrics),
    },
    null,
    2,
  ) + '\n',
);
if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exitCode = 1;
} else
  process.stdout.write(
    `Architecture policy passed; ${exceptions.length} explicit, frozen exceptions.\n`,
  );

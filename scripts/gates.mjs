import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { planGates, gateEntries, filesUnder } from './policy/inventory.mjs';
import { runProcess } from './gates/process.mjs';
import { lockGates } from './gates/lock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(await readFile(resolve(root, 'config/gates.json'), 'utf8'));
const selected = process.argv.slice(2);
if (selected.includes('--list')) {
  process.stdout.write(
    JSON.stringify({ profiles: registry.profiles, tasks: Object.keys(registry.tasks) }, null, 2) +
      '\n',
  );
} else {
  await main(selected.length ? selected : ['verify']);
}
function commandsFor(name, task, files) {
  if (task.commands) return task.commands;
  const entries = gateEntries(task, files);
  if (!entries.length) throw new Error(`No tests discovered in ${name}`);
  if (task.kind === 'node-test')
    return [
      {
        script: null,
        args: [
          '--test',
          `--test-concurrency=${task.concurrency ?? 1}`,
          '--test-timeout=180000',
          '--test-reporter=spec',
          '--test-reporter=junit',
          '--test-reporter-destination=stdout',
          `--test-reporter-destination=test-results/gates/${name}.xml`,
          ...(name === 'unit'
            ? ['--experimental-test-coverage', '--test-coverage-include=packages/*/dist/**/*.js']
            : []),
          ...entries,
        ],
      },
    ];
  if (task.kind === 'scenario') return entries.map((script) => ({ script, args: task.args ?? [] }));
  throw new Error(`Invalid gate kind: ${name}`);
}
async function prerequisite(task) {
  if (task.database && !process.env.ARKVORY_TEST_DATABASE_URL)
    throw new Error(
      'ARKVORY_TEST_DATABASE_URL must point to a dedicated test database; configure .env.test (see .env.test.example).',
    );
  if (task.browser) {
    const { chromium } = await import('playwright');
    if (!process.env.ARKVORY_BROWSER_CHANNEL) {
      try {
        await access(chromium.executablePath());
      } catch {
        throw new Error(
          'Pinned Chromium is missing. Run npm run test:browser:install, or explicitly select an installed ARKVORY_BROWSER_CHANNEL.',
        );
      }
    }
  }
}
async function execute(name, task, files, signal) {
  const deadline = Date.now() + task.timeoutSeconds * 1000;
  await prerequisite(task);
  for (const command of commandsFor(name, task, files)) {
    const npm = process.env.npm_execpath;
    if (command.script === '$npm' && (!npm || !isAbsolute(npm)))
      throw new Error(
        'Security audit must be started with npm run gate (npm CLI path unavailable).',
      );
    const script =
      command.script === '$npm'
        ? npm
        : command.script === null
          ? command.args[0]
          : resolve(root, command.script);
    const args = command.script === null ? command.args.slice(1) : command.args;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Gate timeout: ${name}`);
    await runProcess(script, args, { cwd: root, timeoutMs: remaining, signal });
  }
}
async function main(selection) {
  let release;
  const report = {
    selected: selection,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    node: process.version,
    platform: process.platform,
    startedAt: new Date().toISOString(),
    status: 'failed',
    tasks: [],
  };
  const controller = new AbortController(),
    abort = () => controller.abort();
  report.dirty =
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim().length > 0;
  try {
    const plan = planGates(registry, selection);
    report.tasks = plan.map((name) => ({ name, status: 'not_run' }));
    // Check prerequisites before spending time compiling; missing resources are failures, never skips.
    for (const name of plan) await prerequisite(registry.tasks[name]);
    release = await lockGates(root);
    await mkdir(resolve(root, 'test-results/gates'), { recursive: true });
    const files = await filesUnder(root, 'tests');
    process.on('SIGINT', abort);
    process.on('SIGTERM', abort);
    for (const result of report.tasks) {
      const { name } = result;
      result.status = 'running';
      result.startedAt = new Date().toISOString();
      process.stdout.write(`\nGate: ${name}\n`);
      try {
        await execute(name, registry.tasks[name], files, controller.signal);
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        throw error;
      } finally {
        result.finishedAt = new Date().toISOString();
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
    process.stderr.write(`Gate failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      await mkdir(resolve(root, 'test-results/gates'), { recursive: true });
      await writeFile(
        resolve(root, 'test-results/gates', randomUUID() + '.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    } finally {
      if (release) await release();
    }
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}

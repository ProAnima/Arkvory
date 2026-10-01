import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { profiles } from './lanes.mjs';
import { runLocalCi } from './local-run.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Usage: npm run ci:local -- [verify|release] [--lane windows,linux,linux-system]
       [--allow-dirty] [--keep-containers]

Runs the GitHub check lanes on this machine: Windows gates on the host, Linux gates in a Docker
container and service-install gates in a disposable systemd container. Evidence is written to
test-results/local-ci/<commit>-<profile>/evidence.{json,md}.`;

export function parseArguments(argv) {
  const options = { profile: 'verify', allowDirty: false, keep: false, laneNames: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (profiles.includes(argument)) options.profile = argument;
    else if (argument === '--allow-dirty') options.allowDirty = true;
    else if (argument === '--keep-containers') options.keep = true;
    else if (argument === '--lane' && argv[index + 1])
      options.laneNames = argv[++index].split(',').filter(Boolean);
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}\n\n${usage}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage + '\n');
  } else {
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    const { evidence, folder } = await runLocalCi(root, { ...options, signal: controller.signal });
    process.stdout.write('\n' + (await readFile(`${folder}/evidence.md`, 'utf8')));
    process.stdout.write(`\nEvidence: ${folder}\n`);
    if (evidence.status !== 'passed') process.exitCode = 1;
  }
}

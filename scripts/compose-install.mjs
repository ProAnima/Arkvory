import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { parseArgs } from 'node:util';

// One command for running a source checkout in Docker: compile, package the same release bundle
// that the gates verify, then install it in compose mode (API, worker and PostgreSQL 18.4).
const usage =
  'Usage: npm run deploy:compose -- --root <absolute dedicated directory> [--version 0.1.0] [--engine docker|podman]';
const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    version: { type: 'string', default: '0.0.1' },
    engine: { type: 'string', default: 'docker' },
  },
  strict: true,
});
if (!values.root || !isAbsolute(values.root)) throw new Error(usage);
const npm = process.env.npm_execpath;
if (!npm || !isAbsolute(npm)) throw new Error('Start through npm: ' + usage);
const artifact = join(await mkdtemp(join(tmpdir(), 'arkvory-compose-')), 'artifact');
const node = (args) => execFileSync(process.execPath, args, { stdio: 'inherit' });
node([npm, 'run', 'build']);
node([npm, 'run', 'release:package', '--', values.version, artifact]);
node([
  join(artifact, 'arkvory-setup.mjs'),
  'install',
  '--root',
  resolve(values.root),
  '--mode',
  'compose',
  '--engine',
  values.engine,
  '--artifact',
  artifact,
]);
// Installation extracts its own release copy; the temporary bundle is kept only after a failure.
await rm(dirname(artifact), { recursive: true });

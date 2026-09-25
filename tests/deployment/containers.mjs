import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { verifyReleaseFiles } from '../../scripts/release-files.mjs';
const run = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
run(['info']);
for (const args of [
  ['ps', '-aq'],
  ['volume', 'ls', '-q'],
]) {
  if (run([...args, '--filter', 'label=com.docker.compose.project=proanima-depot']))
    throw Error('Deployment container gate requires an unused proanima-depot project');
}
const temporary = await mkdtemp(join(tmpdir(), 'depot-container-gate-'));
const artifact = process.env.DEPOT_RELEASE_ARTIFACT ?? join(temporary, 'artifact');
const root = join(temporary, 'install');
if (!process.env.DEPOT_RELEASE_ARTIFACT)
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', '0.0.1', artifact],
    { stdio: 'inherit' },
  );
const manifest = JSON.parse(await readFile(join(artifact, 'depot-release.json'), 'utf8'));
await verifyReleaseFiles(
  artifact,
  manifest.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const nextVersion = manifest.version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const bundle = join(temporary, 'Linux installer with spaces');
await mkdir(bundle);
execFileSync('tar', ['-xzf', join(artifact, 'Depot-Linux.tar.gz'), '-C', bundle]);
const manage = (args) =>
  args[0] === 'install'
    ? execFileSync('bash', [join(bundle, 'install.sh'), '--mode', 'compose'], {
        env: { ...process.env, DEPOT_INSTALL_ROOT: root, DEPOT_ARTIFACT_DIR: bundle },
        stdio: 'inherit',
      })
    : execFileSync(process.execPath, [join(root, 'manage.mjs'), ...args, '--root', root], {
        stdio: 'inherit',
      });
const compose = [
  'compose',
  '--project-name',
  'proanima-depot',
  '--project-directory',
  root,
  '--env-file',
  join(root, 'config/compose.env'),
  '-f',
  join(root, 'releases', manifest.version, 'deploy/compose.yml'),
];
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:8080/health/ready', {
        headers: {
          Authorization: `Bearer ${(await readFile(join(root, 'config/health-token.txt'), 'utf8')).trim()}`,
        },
        signal: AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await delay(1000);
  }
  throw Error('Container API readiness timed out');
}
try {
  manage(['install', '--mode', 'compose', '--artifact', artifact]);
  run([
    ...compose,
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    "require('fs').writeFileSync('/var/lib/depot/deployment-sentinel','preserved')",
  ]);
  const before = run(['inspect', '--format', '{{.RestartCount}}', 'proanima-depot-api-1']);
  try {
    run([
      ...compose,
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "const fs=require('fs');for(const p of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))){try{const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8');if(c.split('\\0')[1]==='apps/deploy/dist/container.js')process.kill(Number(p),'SIGKILL');}catch{}}",
    ]);
  } catch (error) {
    // Killing the container's main process can also kill docker exec before it returns.
    // Readiness and RestartCount below still must prove automatic recovery.
    if (error.status !== 137) throw error;
  }
  await delay(3000);
  await ready();
  assert.ok(
    Number(run(['inspect', '--format', '{{.RestartCount}}', 'proanima-depot-api-1'])) >
      Number(before),
    'Container must restart after process crash',
  );
  const next = join(temporary, 'next');
  await mkdir(next);
  await copyFile(join(artifact, 'depot-runtime.zip'), join(next, 'depot-runtime.zip'));
  await writeFile(
    join(next, 'depot-release.json'),
    JSON.stringify({ ...manifest, version: nextVersion }),
  );
  manage(['update', '--artifact', next]);
  assert.equal(
    run([
      ...compose,
      'exec',
      '-T',
      'api',
      'node',
      '-e',
      "process.stdout.write(require('fs').readFileSync('/var/lib/depot/deployment-sentinel','utf8'))",
    ]),
    'preserved',
  );
  assert.equal(
    JSON.parse(await readFile(join(root, 'installation.json'), 'utf8')).current.version,
    nextVersion,
  );
  console.log('Container install, migrations, crash restart and persistent-volume update passed');
} catch (error) {
  console.error(run([...compose, 'logs', '--no-color', '--tail', '40', 'api', 'worker']));
  run([...compose, 'stop', '--timeout', '10', 'api', 'worker']);
  const diagnostic =
    "import {readFile} from 'node:fs/promises';Object.assign(process.env,JSON.parse(await readFile('/run/depot/runtime.json','utf8')));process.env.DEPOT_WEB_DIR='/opt/depot/apps/web/public';try{const {loadConfig}=await import('./apps/api/dist/config.js');const {createServer}=await import('./apps/api/dist/server.js');const app=await createServer(await loadConfig(process.env));await app.close();}catch(e){console.error('Startup diagnostic: '+String(e.message).replace(/postgres(?:ql)?:\\/\\/\\S+/g,'[database URL redacted]'));process.exitCode=1;}";
  try {
    run([
      ...compose,
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'node',
      'api',
      '--input-type=module',
      '-e',
      diagnostic,
    ]);
  } catch {
    console.error('Startup diagnostic reported a failure');
  }
  throw error;
} finally {
  run([...compose, 'down', '--volumes', '--remove-orphans']);
}

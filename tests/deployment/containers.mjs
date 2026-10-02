import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { verifyReleaseFiles } from '../../scripts/release-files.mjs';
import { tarExecutable } from '../../scripts/tar.mjs';
import { extractArchive } from '../../apps/deploy/dist/archive.js';
import { exerciseUpdateControl } from './update-control.mjs';
import { exerciseContainerRecovery } from './container-recovery.mjs';
import { exerciseBackupAgent, vaultReported, waitForAgent } from './backup-acceptance.mjs';
const windows = process.platform === 'win32';
const run = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
// The gate needs Linux containers. Docker Desktop in Windows-containers mode cannot run the image.
assert.equal(run(['info', '--format', '{{.OSType}}']), 'linux', 'Docker must run Linux containers');
for (const args of [
  ['ps', '-aq'],
  ['volume', 'ls', '-q'],
]) {
  if (run([...args, '--filter', 'label=com.docker.compose.project=proanima-arkvory']))
    throw Error('Deployment container gate requires an unused proanima-arkvory project');
}
// Windows TEMP may be an 8.3 alias; bind mounts and the updater task use the canonical path.
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'arkvory-container-gate-')));
const artifact = process.env.ARKVORY_RELEASE_ARTIFACT ?? join(temporary, 'artifact');
const root = join(temporary, 'install');
if (!process.env.ARKVORY_RELEASE_ARTIFACT)
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', '0.0.1', artifact],
    { stdio: 'inherit' },
  );
const manifest = JSON.parse(await readFile(join(artifact, 'arkvory-release.json'), 'utf8'));
await verifyReleaseFiles(
  artifact,
  manifest.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const nextVersion = manifest.version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const bundle = join(temporary, `${windows ? 'Windows' : 'Linux'} installer with spaces`);
if (windows) await extractArchive(join(artifact, 'Arkvory-Windows.zip'), bundle);
else {
  await mkdir(bundle);
  execFileSync(tarExecutable(), ['-xzf', join(artifact, 'Arkvory-Linux.tar.gz'), '-C', bundle]);
}
// Windows PowerShell 5 must not inherit PowerShell 7's incompatible module search path.
const powershellEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
);
// Both hosts run the shipped bundle entrypoint, including the checksum-verified Node.js download.
function installFromBundle() {
  if (windows)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(bundle, 'install.ps1'),
        '-Mode',
        'compose',
        '-Root',
        root,
        '-Artifact',
        bundle,
      ],
      { env: powershellEnvironment, stdio: 'inherit', windowsHide: true },
    );
  else
    execFileSync('bash', [join(bundle, 'install.sh'), '--mode', 'compose'], {
      env: { ...process.env, ARKVORY_INSTALL_ROOT: root, ARKVORY_ARTIFACT_DIR: bundle },
      stdio: 'inherit',
    });
}
const manage = (args) =>
  args[0] === 'install'
    ? installFromBundle()
    : execFileSync(process.execPath, [join(root, 'manage.mjs'), ...args, '--root', root], {
        stdio: 'inherit',
      });
// An elevated Windows run registers the SYSTEM updater for this temporary root; never leave it.
function removeWindowsUpdater() {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$task = Get-ScheduledTask -TaskName ProAnimaArkvoryUpdate -ErrorAction SilentlyContinue; if ($task -and ($task.Actions | Where-Object { $_.Arguments.Contains($env:ARKVORY_GATE_ROOT) })) { Unregister-ScheduledTask -TaskName ProAnimaArkvoryUpdate -Confirm:$false }',
    ],
    {
      env: { ...powershellEnvironment, ARKVORY_GATE_ROOT: root },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
}
const compose = [
  'compose',
  '--project-name',
  'proanima-arkvory',
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
// A host directory next to the installation, bind-mounted into the backup container.
const vault = join(temporary, 'backup vault');
let vaultId = null;
try {
  manage(['install', '--mode', 'compose', '--artifact', artifact]);
  const token = (await readFile(join(root, 'config/bootstrap-token.txt'), 'utf8')).trim();
  await exerciseUpdateControl(token, async () => {
    manage(['updates-poll']);
  });
  await mkdir(vault);
  const capture = await exerciseBackupAgent(token, async () => {
    manage(['configure', '--backup-vault', vault, '--init-vault']);
  });
  vaultId = capture.vaultId;
  // The point is visible to the agent exactly where it wrote it: committed in the host vault.
  run([
    ...compose,
    'exec',
    '-T',
    'backup',
    'node',
    '-e',
    `require('fs').accessSync('/srv/arkvory-vault/points/${capture.pointId}/COMMITTED')`,
  ]);
  run([
    ...compose,
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    "require('fs').writeFileSync('/var/lib/arkvory/deployment-sentinel','preserved')",
  ]);
  await exerciseContainerRecovery(run, compose, ready);
  const next = join(temporary, 'next');
  await mkdir(next);
  await copyFile(join(artifact, 'arkvory-runtime.zip'), join(next, 'arkvory-runtime.zip'));
  await writeFile(
    join(next, 'arkvory-release.json'),
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
      "process.stdout.write(require('fs').readFileSync('/var/lib/arkvory/deployment-sentinel','utf8'))",
    ]),
    'preserved',
  );
  assert.equal(
    JSON.parse(await readFile(join(root, 'installation.json'), 'utf8')).current.version,
    nextVersion,
  );
  // The update recreates the agent from the new image with the same vault mount.
  await waitForAgent(
    token,
    (status) => vaultReported(status) && status.vault.id === vaultId,
    'The backup agent must report its vault after the update',
  );
  console.log(
    'Container install, migrations, backup agent, crash restart and persistent-volume update passed',
  );
} catch (error) {
  console.error(run([...compose, 'logs', '--no-color', '--tail', '40', 'api', 'worker', 'backup']));
  run([...compose, 'stop', '--timeout', '10', 'api', 'worker']);
  const diagnostic =
    "import {readFile} from 'node:fs/promises';Object.assign(process.env,JSON.parse(await readFile('/run/arkvory/runtime.json','utf8')));process.env.ARKVORY_WEB_DIR='/opt/arkvory/apps/web/public';try{const {loadConfig}=await import('./apps/api/dist/config.js');const {createServer}=await import('./apps/api/dist/server.js');const app=await createServer(await loadConfig(process.env));await app.close();}catch(e){console.error('Startup diagnostic: '+String(e.message).replace(/postgres(?:ql)?:\\/\\/\\S+/g,'[database URL redacted]'));process.exitCode=1;}";
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
  try {
    run([...compose, 'down', '--volumes', '--remove-orphans']);
    // On Linux the vault belongs to the container user (uid 1000); return it to this runner.
    if (!windows && vaultId !== null)
      run([
        'run',
        '--rm',
        '--user',
        '0:0',
        '--network',
        'none',
        '-v',
        `${vault}:/vault`,
        '--entrypoint',
        'chown',
        `proanima-arkvory:${manifest.version}`,
        '-R',
        `${process.getuid()}:${process.getgid()}`,
        '/vault',
      ]);
  } finally {
    if (windows) removeWindowsUpdater();
  }
}
// Reached only after a passing run; failures keep the installation root for diagnosis.
await rm(temporary, { recursive: true, force: true, maxRetries: 3 });

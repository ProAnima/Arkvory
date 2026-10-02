import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { source, stage } from '../../apps/deploy/dist/staging.js';
import { verifyReleaseFiles } from '../../scripts/release-files.mjs';
import { verifyInstallers } from '../../scripts/verify-installers.mjs';
import { extractArchive } from '../../apps/deploy/dist/archive.js';

const root = await mkdtemp(join(tmpdir(), 'arkvory-package-gate-'));
const output = process.env.ARKVORY_RELEASE_ARTIFACT ?? join(root, 'artifact');
assert.ok(process.env.npm_execpath, 'Run through npm gate');
if (!process.env.ARKVORY_RELEASE_ARTIFACT)
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', '0.0.1', output],
    { stdio: 'inherit' },
  );
const release = JSON.parse(await readFile(join(output, 'arkvory-release.json'), 'utf8'));
await verifyReleaseFiles(
  output,
  release.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
await verifyInstallers(output, root, extractArchive);
assert.equal(
  JSON.parse(
    execFileSync(process.execPath, [join(output, 'arkvoryctl.mjs'), '--version'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ).version,
  release.version,
);
assert.match(
  execFileSync(process.execPath, [join(output, 'arkvoryctl.mjs'), '--help', '--lang', 'ru'], {
    cwd: root,
    encoding: 'utf8',
  }),
  /Удалённый клиент/,
);
const target = join(root, 'installation');
assert.match(
  execFileSync(process.execPath, [join(output, 'arkvory-remote.mjs'), '--help'], {
    cwd: root,
    encoding: 'utf8',
  }),
  /Remote Setup/,
);
const selected = await source(target, null, output);
await stage(target, selected);
await stage(target, selected);
const runtime = join(target, 'releases', release.version);
// Import in a separate process so resolution cannot reuse any workspace dependencies from the test process.
const server = pathToFileURL(join(runtime, 'apps/api/dist/server.js')).href;
const code = `const module=await import(${JSON.stringify(server)}); if(typeof module.createServer!=='function') throw Error('Missing server');`;
execFileSync(process.execPath, ['--input-type=module', '-e', code], {
  cwd: runtime,
  stdio: 'inherit',
});
// The backup operator CLI ships in the same runtime and resolves only production dependencies.
assert.match(
  execFileSync(process.execPath, [join(runtime, 'apps/backup/dist/main.js'), '--help'], {
    cwd: runtime,
    encoding: 'utf8',
  }),
  /arkvory-backup/,
);
await assert.rejects(access(join(runtime, 'node_modules/typescript')), /ENOENT/);
await assert.rejects(access(join(runtime, '.env')), /ENOENT/);
const state = {
  format: 1,
  mode: 'systemd',
  engine: 'docker',
  automatic: false,
  pin: null,
  current: selected.release,
};
const { writeFile, mkdir } = await import('node:fs/promises');
await writeFile(join(target, 'installation.json'), JSON.stringify(state));
// configure --init-vault goes through the release launcher to the backup CLI of that release.
await mkdir(join(target, 'config'));
await writeFile(
  join(target, 'config/runtime.json'),
  JSON.stringify({ ARKVORY_DATA_DIR: join(target, 'data') }),
);
const vault = join(root, 'backup vault');
execFileSync(
  process.execPath,
  [join(runtime, 'deploy/launcher.mjs'), target, 'vault-init', vault],
  { cwd: root, stdio: 'inherit' },
);
assert.equal(JSON.parse(await readFile(join(vault, 'vault.json'), 'utf8')).format, 'arkvory-vault');
assert.throws(() =>
  execFileSync(
    process.execPath,
    [join(runtime, 'deploy/launcher.mjs'), target, 'vault-init', vault],
    {
      cwd: root,
      stdio: 'ignore',
    },
  ),
);
// Service scripts run unattended as root/Administrator: they must at least parse.
const bash =
  process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git/bin/bash.exe') : 'bash';
for (const name of ['register-linux.sh', 'backup-vault-linux.sh', 'database-linux.sh'])
  execFileSync(bash, ['-n', join(runtime, 'deploy', name)], { stdio: 'inherit' });
const powershellEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
);
for (const name of ['register-windows.ps1', 'backup-vault-windows.ps1', 'native/remove.ps1'])
  execFileSync(
    process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:ARKVORY_PARSE_PATH,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }',
    ],
    {
      env: { ...powershellEnvironment, ARKVORY_PARSE_PATH: join(runtime, 'deploy', name) },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
execFileSync(process.execPath, [join(output, 'arkvory-setup.mjs'), 'status', '--root', target], {
  cwd: root,
  stdio: 'inherit',
});
assert.equal(
  JSON.parse(await readFile(join(runtime, 'release.json'), 'utf8')).version,
  release.version,
);
console.log(
  'Portable release packaging, extraction, standalone bootstrap and production dependency resolution passed',
);
// Kept on failure for diagnosis; a passing run must not accumulate candidates in TEMP.
await rm(root, { recursive: true, force: true, maxRetries: 3 });

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { source, stage } from '../../apps/deploy/dist/staging.js';
import { verifyReleaseFiles } from '../../scripts/release-files.mjs';
import { verifyInstallers } from '../../scripts/verify-installers.mjs';
import { extractArchive } from '../../apps/deploy/dist/archive.js';

const root = await mkdtemp(join(tmpdir(), 'depot-package-gate-'));
const output = process.env.DEPOT_RELEASE_ARTIFACT ?? join(root, 'artifact');
assert.ok(process.env.npm_execpath, 'Run through npm gate');
if (!process.env.DEPOT_RELEASE_ARTIFACT)
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', '0.0.1', output],
    { stdio: 'inherit' },
  );
const release = JSON.parse(await readFile(join(output, 'depot-release.json'), 'utf8'));
await verifyReleaseFiles(
  output,
  release.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
await verifyInstallers(output, root, extractArchive);
assert.equal(
  JSON.parse(
    execFileSync(process.execPath, [join(output, 'depotctl.mjs'), '--version'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ).version,
  release.version,
);
assert.match(
  execFileSync(process.execPath, [join(output, 'depotctl.mjs'), '--help', '--lang', 'ru'], {
    cwd: root,
    encoding: 'utf8',
  }),
  /Удалённый клиент/,
);
const target = join(root, 'installation');
assert.match(
  execFileSync(process.execPath, [join(output, 'depot-remote.mjs'), '--help'], {
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
const { writeFile } = await import('node:fs/promises');
await writeFile(join(target, 'installation.json'), JSON.stringify(state));
execFileSync(process.execPath, [join(output, 'depot-setup.mjs'), 'status', '--root', target], {
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

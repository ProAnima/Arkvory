import {
  mkdtemp,
  mkdir,
  copyFile,
  cp,
  readFile,
  writeFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { ZipFile } from 'yazl';
import { SCHEMA_VERSION } from '@proanima/arkvory-infrastructure';
import { packageInstallers } from './package-installers.mjs';

const version = process.argv[2];
if (!/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(version ?? ''))
  throw new Error('Usage: npm run release:package -- 1.2.3 [output]');
const output = resolve(process.argv[3] ?? `artifacts/${version}`);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length !== 0)
  throw new Error('Release output must be empty; refusing to replace existing artifacts');
// Windows TEMP may use an 8.3 alias. Compare canonical paths on both sides of the containment check.
const staging = await realpath(await mkdtemp(join(tmpdir(), 'arkvory-release-')));
const { units } = JSON.parse(await readFile('config/architecture.json', 'utf8'));
for (const name of ['package.json', 'package-lock.json', 'LICENSE.md'])
  await copyFile(name, join(staging, name));
for (const unit of units) {
  await mkdir(join(staging, unit.path), { recursive: true });
  await copyFile(join(unit.path, 'package.json'), join(staging, unit.path, 'package.json'));
  await cp(join(unit.path, 'dist'), join(staging, unit.path, 'dist'), { recursive: true });
}
await cp('apps/web/public', join(staging, 'apps/web/public'), { recursive: true });
await cp('deploy', join(staging, 'deploy'), { recursive: true });
await cp('docs', join(staging, 'docs'), { recursive: true });
for (const name of ['README.md', 'README.ru.md']) await copyFile(name, join(staging, name));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run packager through npm');
execFileSync(
  process.execPath,
  [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: staging, stdio: 'inherit' },
);
await build({
  entryPoints: ['apps/deploy/src/launch.ts'],
  outfile: join(staging, 'deploy/launcher.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
await build({
  entryPoints: ['apps/deploy/src/manage.ts'],
  outfile: join(staging, 'deploy/manage.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
});
await build({
  entryPoints: ['apps/deploy/src/main.ts'],
  outfile: join(output, 'arkvory-setup.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
await copyFile(join(output, 'arkvory-setup.mjs'), join(staging, 'deploy/arkvory-setup.mjs'));
const sshLicenses = await Promise.all(
  ['ssh2', 'asn1', 'safer-buffer', 'bcrypt-pbkdf', 'tweetnacl'].map(
    async (name) => `${name}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`,
  ),
);
await build({
  entryPoints: ['apps/deploy/src/remote-main.ts'],
  outfile: join(output, 'arkvory-remote.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['cpu-features'],
  banner: {
    // ssh2 initializes optional agent helpers on import. Agent authentication is not exposed by the wizard.
    js:
      '/* Bundled dependency licenses\n' +
      sshLicenses.join('\n\n').replaceAll('*/', '* /') +
      '\n*/\n' +
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const __dirname = import.meta.dirname; const __filename = import.meta.filename;",
  },
});
await build({
  entryPoints: ['apps/cli/src/main.ts'],
  outfile: join(output, 'arkvoryctl.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  define: { 'process.env.ARKVORY_CLI_VERSION': JSON.stringify(version) },
  banner: {
    js:
      '/* Bundled SHA-256 implementation: @noble/hashes, MIT License.\n' +
      (await readFile('node_modules/@noble/hashes/LICENSE', 'utf8')).replaceAll('*/', '* /') +
      '\n*/',
  },
});
const zip = new ZipFile();
const archive = join(output, 'arkvory-runtime.zip');
const completed = pipeline(zip.outputStream, createWriteStream(archive, { flags: 'wx' }));
async function addDirectory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.bin') continue;
    const path = join(directory, entry.name),
      name = prefix + entry.name;
    const actual = await realpath(path);
    const contained = relative(staging, actual);
    if (contained.startsWith('..') || isAbsolute(contained))
      throw new Error('Package dependency escapes staging');
    const info = await stat(path);
    if (info.isDirectory()) await addDirectory(path, name + '/');
    else if (info.isFile() && /\.(node|dll|so|dylib)$/i.test(entry.name))
      throw new Error('Native dependency requires platform-specific release packaging');
    else if (info.isFile())
      zip.addFile(path, name, { mode: 0o100644, mtime: new Date('2026-01-01T00:00:00Z') });
    else throw new Error('Unsupported release entry');
  }
}
await addDirectory(staging);
zip.end();
await completed;
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const release = {
  format: 1,
  version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  schema: SCHEMA_VERSION,
  archiveSha256: await digest(archive),
  setupSha256: await digest(join(output, 'arkvory-setup.mjs')),
};
await writeFile(join(output, 'arkvory-release.json'), JSON.stringify(release, null, 2) + '\n', {
  flag: 'wx',
});
for (const name of ['install.sh', 'install.ps1'])
  await copyFile(join('deploy', name), join(output, name));
await packageInstallers(output, staging, release);
// The staging tree (production node_modules) is only an input of the archives; every packaging
// run created a fresh one, so keeping it leaked hundreds of MiB per gate run into TEMP.
if (process.env.ARKVORY_KEEP_RELEASE_STAGING === '1')
  console.log(`Release ${version}: ${output}. Staging kept: ${staging}`);
else {
  await rm(staging, { recursive: true, force: true, maxRetries: 3 });
  console.log(`Release ${version}: ${output}`);
}

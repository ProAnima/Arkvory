import { mkdir, mkdtemp, cp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dependency } from './native-dependencies.mjs';
import { verifyReleaseFiles, sha256 } from './release-files.mjs';
import { linuxPackages } from './package-native-linux.mjs';
import { tarExecutable } from './tar.mjs';
import { windowsClient, linuxClient } from './package-client.mjs';

const source = resolve(process.argv[2] ?? ''),
  output = resolve(process.argv[3] ?? 'artifacts/native');
const release = JSON.parse(await readFile(join(source, 'arkvory-release.json'), 'utf8'));
await verifyReleaseFiles(
  source,
  release.version,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), 'arkvory-native-'));
const payload = join(stage, 'payload');
await mkdir(payload);
const cache = resolve('.cache/native-downloads');
for (const name of ['arkvory-runtime.zip', 'arkvory-release.json', 'arkvory-setup.mjs'])
  await copyFile(join(source, name), join(payload, name));
for (const name of ['LICENSE.md', 'LICENSE.ru.md', 'NOTICE.md'])
  await copyFile(name, join(payload, name));
let files;
if (process.platform === 'win32') files = await windowsPackage();
else if (process.platform === 'linux' && process.arch === 'x64') {
  files = await linuxPackages(
    payload,
    stage,
    output,
    release,
    await dependency('nodeLinux', cache),
  );
  files.push(...(await linuxClient(source, stage, output, release)));
} else throw Error('Native packaging supports Windows/Linux x64');
const hashes = {};
for (const name of files) hashes[name] = await sha256(join(output, name));
await writeFile(
  join(output, `native-${process.platform}.json`),
  JSON.stringify({ version: release.version, commit: release.commit, files: hashes }, null, 2),
);
// The stage holds expanded runtimes and installer inputs only; the packages are in `output`.
await rm(stage, { recursive: true, force: true, maxRetries: 3 });
console.log(`Native packages: ${output}`);

function powershell(script, environment = {}) {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...environment }).filter(
      ([key]) => key.toLowerCase() !== 'psmodulepath',
    ),
  );
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
}
async function expand(archive, destination) {
  powershell(
    'Expand-Archive -LiteralPath $env:ARKVORY_ARCHIVE -DestinationPath $env:ARKVORY_DESTINATION',
    { ARKVORY_ARCHIVE: archive, ARKVORY_DESTINATION: destination },
  );
}
async function windowsPackage() {
  const runtime = join(payload, 'runtime');
  await mkdir(runtime);
  const nodeArchive = join(stage, 'node.zip');
  await copyFile(await dependency('nodeWindows', cache), nodeArchive);
  await expand(nodeArchive, join(stage, 'node'));
  await copyFile(join(stage, 'node/node-v24.21.0-win-x64/node.exe'), join(runtime, 'node.exe'));
  await copyFile(
    join(stage, 'node/node-v24.21.0-win-x64/LICENSE'),
    join(runtime, 'NODE-LICENSE.txt'),
  );
  const pgArchive = join(stage, 'pg.zip');
  await copyFile(await dependency('postgres', cache), pgArchive);
  await mkdir(join(stage, 'pg'));
  // Do not unpack pgAdmin/StackBuilder: they are not runtime dependencies of Arkvory.
  execFileSync(
    tarExecutable(),
    [
      '-xf',
      pgArchive,
      '-C',
      join(stage, 'pg'),
      'pgsql/bin',
      'pgsql/lib',
      'pgsql/share',
      'pgsql/doc',
      'pgsql/server_license.txt',
      'pgsql/commandlinetools_3rd_party_licenses.txt',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  const postgres = join(runtime, 'postgres');
  await mkdir(postgres);
  for (const name of [
    'bin',
    'lib',
    'share',
    'doc',
    'server_license.txt',
    'commandlinetools_3rd_party_licenses.txt',
  ])
    await cp(join(stage, 'pg/pgsql', name), join(postgres, name), { recursive: true });
  await copyFile(await dependency('winsw', cache), join(runtime, 'WinSW-x64.exe'));
  await copyFile(await dependency('visualCpp', cache), join(payload, 'vc_redist.x64.exe'));
  for (const name of ['prepare.ps1', 'remove.ps1', 'arkvory.ps1', 'apply.ps1'])
    await copyFile(join('deploy/native', name), join(payload, name));
  await copyFile('branding/icons/arkvory.ico', join(payload, 'arkvory.ico'));
  await copyFile('branding/icons/arkvory-cli.ico', join(payload, 'arkvory-cli.ico'));
  await copyFile('deploy/native/THIRD-PARTY.md', join(payload, 'THIRD-PARTY.md'));
  await copyFile('deploy/native/WINSW-LICENSE.txt', join(runtime, 'WINSW-LICENSE.txt'));
  powershell('& $env:ARKVORY_BRAND -Output $env:ARKVORY_PAYLOAD', {
    ARKVORY_BRAND: resolve('deploy/native/brand.ps1'),
    ARKVORY_PAYLOAD: payload,
  });
  let compiler = process.env.ARKVORY_ISCC;
  if (!compiler) {
    const installer = await dependency('compiler', cache);
    const directory = join(stage, 'inno');
    execFileSync(
      installer,
      ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', `/DIR=${directory}`],
      { stdio: 'inherit', windowsHide: true },
    );
    compiler = join(directory, 'ISCC.exe');
  }
  execFileSync(
    compiler,
    [
      '/Qp',
      `/DPayload=${payload}`,
      `/DArkvoryVersion=${release.version}`,
      `/DOutput=${output}`,
      resolve('deploy/native/windows.iss'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  return [
    'Arkvory-Setup-x64.exe',
    ...(await windowsClient(
      source,
      stage,
      output,
      release,
      compiler,
      runtime,
      join(payload, 'wizard.png'),
    )),
  ];
}

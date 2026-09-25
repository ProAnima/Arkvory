import { mkdir, copyFile, writeFile, readFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

async function clientFiles(source, destination, node, license) {
  await mkdir(destination, { recursive: true });
  await copyFile(join(source, 'depotctl.mjs'), join(destination, 'depotctl.mjs'));
  await copyFile(node, join(destination, process.platform === 'win32' ? 'node.exe' : 'node'));
  await copyFile(license, join(destination, 'NODE-LICENSE.txt'));
  await copyFile('LICENSE.md', join(destination, 'LICENSE.md'));
  await copyFile('docs/CLI.md', join(destination, 'CLI.md'));
}
export async function windowsClient(source, stage, output, release, compiler, runtime, artwork) {
  const payload = join(stage, 'client');
  await clientFiles(source, payload, join(runtime, 'node.exe'), join(runtime, 'NODE-LICENSE.txt'));
  await writeFile(
    join(payload, 'depotctl.cmd'),
    (await readFile('deploy/client/depotctl.cmd', 'utf8')).replace(/\r?\n/g, '\r\n'),
  );
  await copyFile(artwork, join(payload, 'wizard.png'));
  execFileSync(
    compiler,
    [
      '/Qp',
      `/DPayload=${payload}`,
      `/DDepotVersion=${release.version}`,
      `/DOutput=${output}`,
      resolve('deploy/client/windows.iss'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  return ['Depot-CLI-Setup-x64.exe'];
}
export async function linuxClient(source, stage, output, release) {
  const tree = join(stage, 'client-linux'),
    destination = join(tree, 'usr/lib/proanima-depot-cli');
  await clientFiles(source, destination, join(stage, 'node/bin/node'), join(stage, 'node/LICENSE'));
  await chmod(join(destination, 'node'), 0o755);
  await mkdir(join(tree, 'usr/bin'), { recursive: true });
  await copyFile('deploy/client/depotctl', join(tree, 'usr/bin/depotctl'));
  await chmod(join(tree, 'usr/bin/depotctl'), 0o755);
  await mkdir(join(tree, 'DEBIAN'));
  await writeFile(
    join(tree, 'DEBIAN/control'),
    `Package: proanima-depot-cli\nVersion: ${release.version}\nArchitecture: amd64\nMaintainer: Ian Panaev\nSection: net\nPriority: optional\nDepends: ca-certificates, libc6 (>= 2.28), libstdc++6, libgcc-s1, libatomic1\nDescription: ProAnima Depot remote client\n Resumable verified transfers and repository management.\n`,
  );
  execFileSync(
    'dpkg-deb',
    ['--root-owner-group', '--build', tree, join(output, 'Depot-CLI-amd64.deb')],
    { stdio: 'inherit' },
  );
  const rpm = join(stage, 'client-rpm');
  for (const name of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'BUILDROOT'])
    await mkdir(join(rpm, name), { recursive: true });
  const spec = (await readFile('deploy/client/depot-cli.spec', 'utf8'))
    .replaceAll('@VERSION@', release.version)
    .replaceAll('@TREE@', tree);
  await writeFile(join(rpm, 'SPECS/depot-cli.spec'), spec);
  execFileSync(
    'rpmbuild',
    ['-bb', '--define', `_topdir ${resolve(rpm)}`, join(rpm, 'SPECS/depot-cli.spec')],
    { stdio: 'inherit' },
  );
  await copyFile(
    join(rpm, `RPMS/x86_64/proanima-depot-cli-${release.version}-1.x86_64.rpm`),
    join(output, 'Depot-CLI-x86_64.rpm'),
  );
  return ['Depot-CLI-amd64.deb', 'Depot-CLI-x86_64.rpm'];
}

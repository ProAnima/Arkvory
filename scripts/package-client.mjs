import { mkdir, copyFile, writeFile, readFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

async function clientFiles(source, destination, node, license) {
  await mkdir(destination, { recursive: true });
  await copyFile(join(source, 'arkvoryctl.mjs'), join(destination, 'arkvoryctl.mjs'));
  await copyFile(join(source, 'arkvory-remote.mjs'), join(destination, 'arkvory-remote.mjs'));
  await copyFile('node_modules/ssh2/LICENSE', join(destination, 'SSH2-LICENSE.txt'));
  await copyFile(node, join(destination, process.platform === 'win32' ? 'node.exe' : 'node'));
  await copyFile(license, join(destination, 'NODE-LICENSE.txt'));
  for (const name of ['LICENSE.md', 'LICENSE.ru.md', 'NOTICE.md'])
    await copyFile(name, join(destination, name));
  await copyFile('docs/CLI.md', join(destination, 'CLI.md'));
  await copyFile('docs/REMOTE_DEPLOYMENT.md', join(destination, 'REMOTE_DEPLOYMENT.md'));
}
export async function windowsClient(source, stage, output, release, compiler, runtime, artwork) {
  const payload = join(stage, 'client');
  await clientFiles(source, payload, join(runtime, 'node.exe'), join(runtime, 'NODE-LICENSE.txt'));
  await writeFile(
    join(payload, 'arkvoryctl.cmd'),
    (await readFile('deploy/client/arkvoryctl.cmd', 'utf8')).replace(/\r?\n/g, '\r\n'),
  );
  await copyFile('branding/icons/arkvory-cli.ico', join(payload, 'arkvory-cli.ico'));
  await copyFile('branding/icons/arkvory-remote.ico', join(payload, 'arkvory-remote.ico'));
  await copyFile(artwork, join(payload, 'wizard.png'));
  await copyFile('deploy/client/remote-setup.ps1', join(payload, 'remote-setup.ps1'));
  execFileSync(
    compiler,
    [
      '/Qp',
      `/DPayload=${payload}`,
      `/DArkvoryVersion=${release.version}`,
      `/DOutput=${output}`,
      resolve('deploy/client/windows.iss'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  return ['Arkvory-CLI-Setup-x64.exe'];
}
export async function linuxClient(source, stage, output, release) {
  const tree = join(stage, 'client-linux'),
    destination = join(tree, 'usr/lib/proanima-arkvory-cli');
  await clientFiles(source, destination, join(stage, 'node/bin/node'), join(stage, 'node/LICENSE'));
  await chmod(join(destination, 'node'), 0o755);
  await mkdir(join(tree, 'usr/bin'), { recursive: true });
  await mkdir(join(tree, 'usr/share/applications'), { recursive: true });
  await copyFile('deploy/client/arkvory-remote', join(tree, 'usr/bin/arkvory-remote'));
  await chmod(join(tree, 'usr/bin/arkvory-remote'), 0o755);
  await copyFile(
    'deploy/client/arkvory-remote.desktop',
    join(tree, 'usr/share/applications/arkvory-remote.desktop'),
  );
  await copyFile('deploy/client/arkvoryctl', join(tree, 'usr/bin/arkvoryctl'));
  await chmod(join(tree, 'usr/bin/arkvoryctl'), 0o755);
  await mkdir(join(tree, 'usr/share/icons/hicolor/scalable/apps'), { recursive: true });
  await copyFile(
    'branding/icons/arkvory-remote.svg',
    join(tree, 'usr/share/icons/hicolor/scalable/apps/arkvory-remote.svg'),
  );
  await mkdir(join(tree, 'DEBIAN'));
  await writeFile(
    join(tree, 'DEBIAN/control'),
    `Package: proanima-arkvory-cli\nVersion: ${release.version}\nArchitecture: amd64\nMaintainer: Ian Panaev\nSection: net\nPriority: optional\nDepends: ca-certificates, xdg-utils, libc6 (>= 2.28), libstdc++6, libgcc-s1, libatomic1\nDescription: ProAnima Arkvory remote client\n Resumable verified transfers, remote setup and repository management.\n`,
  );
  execFileSync(
    'dpkg-deb',
    ['--root-owner-group', '--build', tree, join(output, 'Arkvory-CLI-amd64.deb')],
    { stdio: 'inherit' },
  );
  const rpm = join(stage, 'client-rpm');
  for (const name of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'BUILDROOT'])
    await mkdir(join(rpm, name), { recursive: true });
  const spec = (await readFile('deploy/client/arkvory-cli.spec', 'utf8'))
    .replaceAll('@VERSION@', release.version)
    .replaceAll('@TREE@', tree);
  await writeFile(join(rpm, 'SPECS/arkvory-cli.spec'), spec);
  execFileSync(
    'rpmbuild',
    ['-bb', '--define', `_topdir ${resolve(rpm)}`, join(rpm, 'SPECS/arkvory-cli.spec')],
    { stdio: 'inherit' },
  );
  await copyFile(
    join(rpm, `RPMS/x86_64/proanima-arkvory-cli-${release.version}-1.x86_64.rpm`),
    join(output, 'Arkvory-CLI-x86_64.rpm'),
  );
  return ['Arkvory-CLI-amd64.deb', 'Arkvory-CLI-x86_64.rpm'];
}

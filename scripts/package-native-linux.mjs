import { mkdir, cp, copyFile, writeFile, readFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tarExecutable } from './tar.mjs';

export async function linuxPackages(payload, stage, output, release, nodeArchive) {
  const tree = join(stage, 'linux');
  const destination = join(tree, 'usr/lib/proanima-arkvory');
  await mkdir(destination, { recursive: true });
  await cp(payload, destination, { recursive: true });
  const node = join(stage, 'node');
  await mkdir(node);
  execFileSync(tarExecutable(), ['-xJf', nodeArchive, '-C', node, '--strip-components=1']);
  await copyFile(join(node, 'bin/node'), join(destination, 'node'));
  await chmod(join(destination, 'node'), 0o755);
  await copyFile(join(node, 'LICENSE'), join(destination, 'NODE-LICENSE.txt'));
  await copyFile('deploy/native/THIRD-PARTY.md', join(destination, 'THIRD-PARTY.md'));
  await mkdir(join(tree, 'usr/bin'), { recursive: true });
  await copyFile('deploy/native/arkvory', join(tree, 'usr/bin/arkvory'));
  await chmod(join(tree, 'usr/bin/arkvory'), 0o755);
  await mkdir(join(tree, 'usr/share/applications'), { recursive: true });
  await copyFile(
    'deploy/native/arkvory.desktop',
    join(tree, 'usr/share/applications/arkvory.desktop'),
  );
  await mkdir(join(tree, 'usr/share/icons/hicolor/scalable/apps'), { recursive: true });
  await copyFile(
    'branding/icons/arkvory.svg',
    join(tree, 'usr/share/icons/hicolor/scalable/apps/arkvory.svg'),
  );
  await mkdir(join(tree, 'DEBIAN'));
  await writeFile(
    join(tree, 'DEBIAN/control'),
    `Package: proanima-arkvory\nVersion: ${release.version}\nArchitecture: amd64\nMaintainer: Ian Panaev\nSection: net\nPriority: optional\nDepends: postgresql (>= 16), systemd, python3, ca-certificates, libc6 (>= 2.28), libstdc++6, libgcc-s1, libatomic1\nDescription: ProAnima Arkvory UPack and file storage\n Dedicated database, supervised services and a browser console.\n`,
  );
  for (const name of ['postinst', 'prerm']) {
    await copyFile(`deploy/native/${name}`, join(tree, 'DEBIAN', name));
    await chmod(join(tree, 'DEBIAN', name), 0o755);
  }
  execFileSync(
    'dpkg-deb',
    ['--root-owner-group', '--build', tree, join(output, 'Arkvory-amd64.deb')],
    { stdio: 'inherit' },
  );
  const rpm = join(stage, 'rpm');
  for (const name of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'BUILDROOT'])
    await mkdir(join(rpm, name), { recursive: true });
  const spec = (await readFile('deploy/native/arkvory.spec', 'utf8'))
    .replaceAll('@VERSION@', release.version)
    .replaceAll('@TREE@', tree);
  await writeFile(join(rpm, 'SPECS/arkvory.spec'), spec);
  execFileSync(
    'rpmbuild',
    ['-bb', '--define', `_topdir ${resolve(rpm)}`, join(rpm, 'SPECS/arkvory.spec')],
    { stdio: 'inherit' },
  );
  await copyFile(
    join(rpm, `RPMS/x86_64/proanima-arkvory-${release.version}-1.x86_64.rpm`),
    join(output, 'Arkvory-x86_64.rpm'),
  );
  return ['Arkvory-amd64.deb', 'Arkvory-x86_64.rpm'];
}

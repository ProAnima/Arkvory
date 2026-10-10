import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The guest base image of the HA stand (ADR 0072, gates deployment-ha*): Ubuntu 24.04 with
 * DRBD 9, the cluster stack and the Arkvory package dependencies. CI builds it in its own job
 * and caches it by this file, so only a change here rebuilds it. Needs KVM and sudo: it runs
 * on a disposable runner only.
 */

// Ubuntu 24.04 cloud image of a fixed release; its checksum is read from the same release.
export const IMAGE_RELEASE = 'https://cloud-images.ubuntu.com/releases/noble/release-20260911';
export const IMAGE = 'ubuntu-24.04-server-cloudimg-amd64.img';
// Everything a node needs, installed once into the base image: DRBD 9 from LINBIT's PPA (the
// kernel ships 8.4), the cluster stack, the fence agents and the Arkvory package dependencies.
const PACKAGES = [
  'drbd-dkms',
  'drbd-utils',
  'pacemaker',
  'pcs',
  'corosync',
  'corosync-qdevice',
  'corosync-qnetd',
  'fence-agents',
  'resource-agents-base',
  // Filesystem is not among the base agents on Ubuntu 24.04.
  'resource-agents-extra',
  'postgresql',
  'python3',
  'libatomic1',
  'xfsprogs',
  'iptables',
];
export const userData = `#cloud-config
package_update: true
package_upgrade: false
runcmd:
  - [sh, -ec, "apt-get install -y linux-headers-$(uname -r) software-properties-common"]
  - [add-apt-repository, -y, "ppa:linbit/linbit-drbd9-stack"]
  - [sh, -ec, "DEBIAN_FRONTEND=noninteractive apt-get install -y ${PACKAGES.join(' ')}"]
  # Arkvory runs its own database; the distribution's cluster never starts.
  - [systemctl, mask, postgresql.service]
  - [systemctl, disable, corosync, pacemaker, corosync-qnetd, corosync-qdevice]
  - [sh, -ec, "modprobe drbd && grep -q '^version: 9' /proc/drbd && echo ARKVORY-BASE-OK > /dev/ttyS0"]
  - [cloud-init, clean, --logs]
power_state:
  mode: poweroff
  timeout: 60
`;

export const baseKey = createHash('sha256')
  .update(IMAGE_RELEASE + userData)
  .digest('hex')
  .slice(0, 16);
export const work = resolve(process.env.ARKVORY_HA_CACHE ?? '.cache/ha-stand');

/** Asynchronous on purpose: transfers run in this process while the stand fails nodes. */
export function run(executable, args, { input, sudo = false, timeoutMs = 10 * 60000 } = {}) {
  const [file, argv] = sudo ? ['sudo', ['-n', executable, ...args]] : [executable, args];
  return new Promise((done, fail) => {
    const child = execFile(
      file,
      argv,
      { encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) fail(Object.assign(error, { stdout, stderr }));
        else done(stdout.trim());
      },
    );
    child.stdin?.end(input);
  });
}

async function download(url, target) {
  await run('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '-o', target, url]);
}

/** The base image with every package and a working DRBD 9 module, built once per definition. */
export async function baseImage() {
  const base = join(work, `base-${baseKey}.qcow2`);
  if (existsSync(base)) return base;
  await mkdir(work, { recursive: true });
  const cloud = join(work, IMAGE);
  if (!existsSync(cloud)) {
    await download(`${IMAGE_RELEASE}/${IMAGE}`, `${cloud}.part`);
    const sums = await run('curl', ['-fsSL', '--retry', '5', `${IMAGE_RELEASE}/SHA256SUMS`]);
    const expected = sums
      .split('\n')
      .find((line) => line.endsWith(`*${IMAGE}`) || line.endsWith(` ${IMAGE}`))
      ?.split(' ')[0];
    const actual = (await run('sha256sum', [`${cloud}.part`])).split(' ')[0];
    if (!expected || expected !== actual) throw new Error(`Checksum mismatch of ${IMAGE}`);
    await run('mv', [`${cloud}.part`, cloud]);
  }
  const building = `${base}.part`;
  await run('qemu-img', ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', cloud, building, '12G']);
  const seed = join(work, 'base-seed.iso');
  await writeFile(join(work, 'user-data'), userData);
  await writeFile(join(work, 'meta-data'), 'instance-id: arkvory-ha-base\nlocal-hostname: base\n');
  await run('cloud-localds', [seed, join(work, 'user-data'), join(work, 'meta-data')]);
  const console = join(work, 'base-console.log');
  // User networking reaches the package mirrors; the guest powers itself off when done.
  await new Promise((done, fail) => {
    const qemu = spawn(
      'sudo',
      [
        '-n',
        'qemu-system-x86_64',
        '-enable-kvm',
        '-m',
        '4096',
        '-smp',
        '4',
        '-display',
        'none',
        '-serial',
        `file:${console}`,
        '-drive',
        `file=${building},if=virtio,format=qcow2`,
        '-drive',
        `file=${seed},if=virtio,format=raw`,
        '-netdev',
        'user,id=net0',
        '-device',
        'virtio-net-pci,netdev=net0',
      ],
      { stdio: 'inherit' },
    );
    const timer = setTimeout(() => qemu.kill('SIGKILL'), 30 * 60000);
    qemu.on('error', fail);
    qemu.on('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
  await run('chown', [`${process.getuid()}:${process.getgid()}`, building, console], {
    sudo: true,
  });
  const log = await readFile(console, 'utf8');
  if (!log.includes('ARKVORY-BASE-OK'))
    throw new Error(`The base image was not provisioned:\n${log.slice(-6000)}`);
  // A self-contained image: the cached file must not depend on the downloaded cloud image.
  await run('qemu-img', ['convert', '-O', 'qcow2', building, base]);
  await rm(building, { force: true });
  return base;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(await baseImage());

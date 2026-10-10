import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { run, work } from '../../scripts/ha-base-image.mjs';

export { baseImage, run } from '../../scripts/ha-base-image.mjs';

/*
 * Virtual machines of the HA stand (ADR 0072). DRBD is a kernel module and its resources are
 * global to a kernel, so every node needs its own kernel: KVM guests under libvirt on a
 * disposable Linux runner, never containers. Fencing is real: Pacemaker in the guests runs
 * fence_virsh, which logs into this host over SSH as a dedicated account and powers the
 * guest off and on through libvirt.
 */

const images = process.env.ARKVORY_HA_IMAGES ?? '/var/lib/libvirt/images/arkvory-ha';
export const HOST_ADDRESS = '192.168.122.1';

/** The SSH identity this process uses for the guests and the one fence_virsh uses for the host. */
export async function keys() {
  const control = join(work, 'control_key');
  const fence = join(work, 'fence_key');
  for (const key of [control, fence])
    if (!existsSync(key)) await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  return {
    control,
    controlPublic: (await readFile(`${control}.pub`, 'utf8')).trim(),
    fence: await readFile(fence, 'utf8'),
    fencePublic: (await readFile(`${fence}.pub`, 'utf8')).trim(),
  };
}

/**
 * The account fence_virsh logs into: allowed to run virsh against the system libvirt only.
 * Removing its authorized key is how the stand breaks fencing on purpose.
 */
export async function fencingAccount(fencePublic) {
  const home = '/home/arkvoryfence';
  try {
    await run('id', ['arkvoryfence']);
  } catch {
    await run(
      'useradd',
      ['--create-home', '--groups', 'libvirt', '--shell', '/bin/bash', 'arkvoryfence'],
      {
        sudo: true,
      },
    );
  }
  await run(
    'install',
    ['-d', '-m', '0700', '-o', 'arkvoryfence', `${home}/.ssh`, `${home}/.config/libvirt`],
    {
      sudo: true,
    },
  );
  await run('tee', [`${home}/.config/libvirt/libvirt.conf`], {
    sudo: true,
    input: 'uri_default = "qemu:///system"\n',
  });
  await run('tee', [`${home}/.ssh/authorized_keys.enabled`], {
    sudo: true,
    input: `${fencePublic}\n`,
  });
  await run('chown', ['-R', 'arkvoryfence:arkvoryfence', home], { sudo: true });
  await setFencing(true);
  await run('systemctl', ['start', 'ssh'], { sudo: true });
}

export async function setFencing(enabled) {
  const ssh = '/home/arkvoryfence/.ssh';
  if (enabled)
    await run(
      'install',
      [
        '-m',
        '0600',
        '-o',
        'arkvoryfence',
        `${ssh}/authorized_keys.enabled`,
        `${ssh}/authorized_keys`,
      ],
      { sudo: true },
    );
  else await run('rm', ['-f', `${ssh}/authorized_keys`], { sudo: true });
}

/** A guest on libvirt's default network, with a fixed address and a second disk for DRBD. */
export async function createGuest(base, guest, publicKey) {
  const domain = `arkvory-ha-${guest.name}`;
  await run('mkdir', ['-p', images], { sudo: true });
  // The hypervisor's account reads the backing image: keep a copy beside the guests' disks,
  // not in the runner's home directory.
  const backing = `${images}/base.qcow2`;
  if (!existsSync(backing)) await run('cp', [base, backing], { sudo: true });
  const system = `${images}/${guest.name}.qcow2`;
  const data = `${images}/${guest.name}-data.raw`;
  const seed = `${images}/${guest.name}-seed.iso`;
  await run('qemu-img', ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', backing, system], {
    sudo: true,
  });
  if (guest.dataGiB)
    await run('qemu-img', ['create', '-f', 'raw', data, `${String(guest.dataGiB)}G`], {
      sudo: true,
    });
  const dir = join(work, guest.name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'user-data'),
    `#cloud-config\nhostname: ${guest.name}\nmanage_etc_hosts: false\ndisable_root: false\nssh_pwauth: false\nssh_authorized_keys: ['${publicKey}']\nwrite_files:\n  - path: /etc/hosts\n    content: |\n      127.0.0.1 localhost\n${guest.hosts.map((line) => `      ${line}`).join('\n')}\n`,
  );
  await writeFile(
    join(dir, 'meta-data'),
    `instance-id: ${domain}\nlocal-hostname: ${guest.name}\n`,
  );
  await writeFile(
    join(dir, 'network-config'),
    `version: 2\nethernets:\n  primary:\n    match: {name: "en*"}\n    addresses: [${guest.address}/24]\n    routes: [{to: default, via: ${HOST_ADDRESS}}]\n    nameservers: {addresses: [${HOST_ADDRESS}]}\n`,
  );
  await run('cloud-localds', [
    '--network-config',
    join(dir, 'network-config'),
    join(dir, 'seed.iso'),
    join(dir, 'user-data'),
    join(dir, 'meta-data'),
  ]);
  await run('cp', [join(dir, 'seed.iso'), seed], { sudo: true });
  await run(
    'virt-install',
    [
      '--name',
      domain,
      '--memory',
      String(guest.memoryMiB ?? 2048),
      '--vcpus',
      '2',
      '--import',
      '--osinfo',
      'ubuntu24.04',
      '--disk',
      `path=${system},bus=virtio`,
      ...(guest.dataGiB ? ['--disk', `path=${data},bus=virtio,format=raw,cache=none`] : []),
      '--disk',
      `path=${seed},device=cdrom`,
      '--network',
      'network=default,model=virtio',
      '--graphics',
      'none',
      '--noautoconsole',
    ],
    { sudo: true },
  );
  return domain;
}

export async function removeGuests() {
  const domains = (await run('virsh', ['list', '--all', '--name'], { sudo: true }))
    .split('\n')
    .filter((name) => name.startsWith('arkvory-ha-'));
  for (const domain of domains) {
    try {
      await run('virsh', ['destroy', domain], { sudo: true });
    } catch {}
    await run('virsh', ['undefine', domain], { sudo: true });
  }
  await run('rm', ['-rf', images], { sudo: true });
}

/** Power: what a PDU or IPMI would do to the machine; fencing does the same through libvirt. */
export const power = {
  off: (domain) => run('virsh', ['destroy', domain], { sudo: true }),
  on: (domain) => run('virsh', ['start', domain], { sudo: true }),
  state: (domain) => run('virsh', ['domstate', domain], { sudo: true }),
};

/** Commands in a guest as root over SSH; `ok: false` keeps a failure as a result. */
export function ssh(key, address) {
  const base = [
    '-i',
    key,
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'BatchMode=yes',
  ];
  return {
    exec: (script, { input } = {}) => run('ssh', [...base, `root@${address}`, script], { input }),
    async tryExec(script) {
      try {
        return { ok: true, output: await run('ssh', [...base, `root@${address}`, script]) };
      } catch (error) {
        return { ok: false, output: String(error.stderr ?? error.message) };
      }
    },
    copy: (from, to) => run('scp', [...base, '-q', from, `root@${address}:${to}`]),
    fetch: (from, to) => run('scp', [...base, '-q', `root@${address}:${from}`, to]),
  };
}

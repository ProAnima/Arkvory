import { mkdir } from 'node:fs/promises';
import { command, commandOutput } from './process.js';
import { report } from './output.js';

/** Every unit of the group, in the order that stops what depends on the database first. */
const STOP_ORDER = [
  'arkvory-update.timer',
  'arkvory-update',
  'arkvory-backup',
  'arkvory-worker',
  'arkvory-api',
  'arkvory-replica',
  'arkvory-database',
  'arkvory-units',
];

/** Whether Pacemaker runs and has the group configured: then it alone moves the volume. */
async function pacemakerHolds(resource: string): Promise<boolean> {
  const running = await command('systemctl', ['is-active', '--quiet', 'pacemaker']).then(
    () => true,
    () => false,
  );
  if (!running) return false;
  const resources = await commandOutput('cibadmin', ['--query', '--scope', 'resources']);
  return resources.includes(`<group id="${resource}"`);
}

async function refuseUnderPacemaker(resource: string): Promise<void> {
  if (await pacemakerHolds(resource))
    throw new Error(
      `Pacemaker manages ${resource}: move it with "arkvory cluster-switchover --to <node>", never by hand`,
    );
}

/** Whether the root is a mount point now (of anything). */
export async function mounted(root: string): Promise<boolean> {
  const found = await commandOutput('findmnt', ['-n', '-o', 'TARGET', '--mountpoint', root]).then(
    (output) => output.trim(),
    () => '',
  );
  return found === root;
}

/**
 * Takes the volume while the cluster is being built (before Pacemaker manages it): this node
 * becomes primary and mounts it at the root. DRBD refuses while another node is primary.
 */
export async function takeVolume(root: string, resource: string): Promise<void> {
  await refuseUnderPacemaker(resource);
  const device = (await commandOutput('drbdadm', ['sh-dev', resource])).trim();
  if (!/^\/dev\/drbd[0-9]+$/.test(device))
    throw new Error(`${resource} is not a DRBD resource of this node (drbdadm sh-dev: ${device})`);
  await command('drbdadm', ['primary', resource]);
  await mkdir(root, { recursive: true });
  await command('mount', [device, root]);
}

/**
 * `arkvory cluster-release`: stops every Arkvory unit, unmounts the volume and makes this node
 * secondary, so another node can take it while the cluster is built. Pacemaker's group is
 * refused: then a switchover moves it.
 */
export async function releaseVolume(root: string, resource: string): Promise<void> {
  await refuseUnderPacemaker(resource);
  await command('systemctl', ['stop', ...STOP_ORDER]);
  if (await mounted(root)) await command('umount', [root]);
  await command('drbdadm', ['secondary', resource]);
  report('info', `${resource} is released: this node is secondary and the volume is unmounted`);
}

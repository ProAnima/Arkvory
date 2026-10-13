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

/** `instead`: what to do on a running cluster, for the command that was refused. */
async function refuseUnderPacemaker(resource: string, instead: string): Promise<void> {
  if (await pacemakerHolds(resource))
    throw new Error(
      `Pacemaker manages ${resource}, so the volume is not moved by hand: ${instead}`,
    );
}
const SWITCHOVER = 'move Arkvory with "arkvory cluster-switchover --to <node>"';
/** For cluster-node on a running cluster: a new node joins with a kit, without the volume. */
export const JOIN_WITH_KIT =
  'on the active node run "arkvory cluster-kit --output <file>", then "arkvory cluster-node --kit <file>" here';

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
export async function takeVolume(
  root: string,
  resource: string,
  instead = SWITCHOVER,
): Promise<void> {
  await refuseUnderPacemaker(resource, instead);
  const device = (await commandOutput('drbdadm', ['sh-dev', resource])).trim();
  if (!/^\/dev\/drbd[0-9]+$/.test(device))
    throw new Error(`${resource} is not a DRBD resource of this node (drbdadm sh-dev: ${device})`);
  await command('drbdadm', ['primary', resource]);
  try {
    await mkdir(root, { recursive: true });
    await command('mount', [device, root]);
  } catch (error) {
    // Never left primary with nothing mounted: another node could not take the volume.
    await command('drbdadm', ['secondary', resource]).catch(() => undefined);
    throw error;
  }
}

/** The Arkvory units this node has; a node being prepared has none yet. */
async function installedUnits(): Promise<Set<string>> {
  const listed = await commandOutput('systemctl', [
    'list-unit-files',
    '--no-legend',
    '--plain',
    'arkvory-*',
  ]).catch(() => '');
  return new Set(
    listed
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter(Boolean)
      .map((unit) => unit.replace(/\.service$/, '')),
  );
}

/**
 * `arkvory cluster-release`: stops every Arkvory unit, unmounts the volume and makes this node
 * secondary, so another node can take it while the cluster is built. Pacemaker's group is
 * refused: then a switchover moves it.
 */
export async function releaseVolume(
  root: string,
  resource: string,
  instead = SWITCHOVER,
): Promise<void> {
  await refuseUnderPacemaker(resource, instead);
  // One unit after another: a single systemctl call queues every stop at once, and the units
  // have no ordering between them, so the database could stop under a running update.
  const units = await installedUnits();
  for (const unit of STOP_ORDER) if (units.has(unit)) await command('systemctl', ['stop', unit]);
  if (await mounted(root)) await command('umount', [root]);
  await command('drbdadm', ['secondary', resource]);
  report('info', `${resource} is released: this node is secondary and the volume is unmounted`);
}

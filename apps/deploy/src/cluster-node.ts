import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, atomicText, exists, jsonFile } from './files.js';
import { command, commandOutput } from './process.js';
import { report } from './output.js';

/**
 * A node of an HA cluster (ADR 0072) is marked outside the replicated volume: install, update and
 * package scripts read it to leave starting and stopping to Pacemaker.
 */
export const NODE_MARKER = '/etc/proanima-arkvory/cluster.json';
const UNITS = '/etc/systemd/system';
/** Every unit Pacemaker starts in the group; none of them is enabled on a cluster node. */
export const CLUSTER_UNITS = [
  'arkvory-database.service',
  'arkvory-replica.service',
  'arkvory-api.service',
  'arkvory-worker.service',
  'arkvory-backup.service',
  'arkvory-update.timer',
  'arkvory-update.service',
] as const;
const ACCOUNTS = ['arkvory', 'arkvory-db'] as const;

export interface NodeMarker {
  readonly root: string;
  readonly resource: string;
}

export async function nodeMarker(): Promise<NodeMarker | null> {
  if (process.platform === 'win32' || !(await exists(NODE_MARKER))) return null;
  const value = await jsonFile(NODE_MARKER);
  const { root, resource } = (value ?? {}) as Record<string, unknown>;
  if (typeof root !== 'string' || typeof resource !== 'string')
    throw new Error(`Invalid ${NODE_MARKER}`);
  return { root, resource };
}

export async function writeNodeMarker(marker: NodeMarker): Promise<void> {
  await mkdir('/etc/proanima-arkvory', { recursive: true, mode: 0o755 });
  await atomicJson(NODE_MARKER, marker);
}

/**
 * Pacemaker must not see Arkvory stop during an update: it would count a failure and may fence or
 * move the node. The group is unmanaged around the change and handed back after readiness.
 */
export async function pacemakerHandsOff(): Promise<void> {
  const resource = await managedResource();
  if (resource) await command('pcs', ['resource', 'unmanage', resource]);
}

export async function pacemakerTakesBack(): Promise<void> {
  const resource = await managedResource();
  if (!resource) return;
  await command('pcs', ['resource', 'cleanup', resource]);
  await command('pcs', ['resource', 'manage', resource]);
}

/**
 * The group Pacemaker manages on this node, if any. While nodes are prepared, before the
 * cluster runs or the group exists, nothing is handed over; a failing query of a running
 * cluster is an error, never a reason to skip.
 */
async function managedResource(): Promise<string | null> {
  const marker = await nodeMarker();
  if (!marker) return null;
  const running = await command('systemctl', ['is-active', '--quiet', 'pacemaker']).then(
    () => true,
    () => false,
  );
  if (!running) return null;
  const resources = await commandOutput('crm_resource', ['--list-raw']);
  return resources.split('\n').some((line) => line.trim() === marker.resource)
    ? marker.resource
    : null;
}

/** The root must be the mount of a DRBD device: otherwise nothing is replicated. */
export async function replicatedMount(root: string): Promise<string> {
  const [source = '', target = ''] = (
    await commandOutput('findmnt', ['-n', '-o', 'SOURCE,TARGET', '--target', root])
  )
    .trim()
    .split(/\s+/);
  if (target !== root || !/^\/dev\/drbd[0-9]+$/.test(source))
    throw new Error(
      `${root} must be the mount point of a DRBD device (found ${source} on ${target})`,
    );
  return source;
}

const kit = (root: string) => join(root, 'config', 'cluster');

async function idOf(flag: '-u' | '-g', account: string): Promise<number> {
  const value = Number((await commandOutput('id', [flag, account])).trim());
  if (!Number.isInteger(value) || value < 1) throw new Error(`Unexpected id of ${account}`);
  return value;
}

export function replicaUnit(root: string): string {
  return `[Unit]
Description=ProAnima Arkvory replica state (ADR 0072)
# Arkvory installation: ${root}
[Service]
Type=exec
User=root
Group=arkvory
UMask=0007
RuntimeDirectory=arkvory
RuntimeDirectoryMode=0750
ExecStart=/usr/bin/arkvory cluster-replica --root ${root}
Restart=always
RestartSec=2
`;
}

/**
 * What every other node needs, kept on the volume: the accounts' ids (files on the volume are
 * owned by them) and the units, so a standby starts exactly what the primary ran.
 */
export async function writeNodeKit(root: string): Promise<void> {
  const accounts: Record<string, { uid: number; gid: number }> = {};
  for (const account of ACCOUNTS)
    accounts[account] = { uid: await idOf('-u', account), gid: await idOf('-g', account) };
  await mkdir(join(kit(root), 'units'), { recursive: true });
  await atomicJson(join(kit(root), 'accounts.json'), accounts);
  await atomicText(join(UNITS, 'arkvory-replica.service'), replicaUnit(root));
  for (const name of await readdir(UNITS))
    if (name.startsWith('arkvory-') && (await exists(join(UNITS, name))))
      if (name.endsWith('.d'))
        for (const dropIn of await readdir(join(UNITS, name))) {
          await mkdir(join(kit(root), 'units', name), { recursive: true });
          await copyFile(join(UNITS, name, dropIn), join(kit(root), 'units', name, dropIn));
        }
      else await copyFile(join(UNITS, name), join(kit(root), 'units', name));
}

/** Units installed on a cluster node: none enabled, Pacemaker starts them. */
export async function disableAutostart(): Promise<void> {
  await command('systemctl', ['daemon-reload']);
  // The update service has no install section: the timer is what starts it.
  await command('systemctl', [
    'disable',
    ...CLUSTER_UNITS.filter((unit) => unit !== 'arkvory-update.service'),
  ]);
}

async function ensureAccount(account: string, ids: { uid: number; gid: number }) {
  const exists = await commandOutput('getent', ['passwd', account]).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await command('groupadd', ['--system', '--gid', String(ids.gid), account]);
    await command('useradd', [
      '--system',
      '--uid',
      String(ids.uid),
      '--gid',
      String(ids.gid),
      '--no-create-home',
      '--shell',
      '/usr/sbin/nologin',
      account,
    ]);
    return;
  }
  const uid = await idOf('-u', account);
  const gid = await idOf('-g', account);
  if (uid !== ids.uid || gid !== ids.gid)
    throw new Error(
      `${account} is ${String(uid)}:${String(gid)} here and ${String(ids.uid)}:${String(ids.gid)} on the volume; change it on this node (usermod -u, groupmod -g) before joining`,
    );
}

/**
 * `arkvory cluster-node`: prepares another data node while the volume is mounted on it (during a
 * planned switchover): the same accounts with the same ids, the same units, none enabled.
 */
export async function joinNode(root: string, resource: string): Promise<void> {
  await replicatedMount(root);
  const accounts = (await jsonFile(join(kit(root), 'accounts.json'))) as Record<
    string,
    { uid: number; gid: number } | undefined
  >;
  for (const account of ACCOUNTS) {
    const ids = accounts[account];
    if (!ids || !Number.isInteger(ids.uid) || !Number.isInteger(ids.gid))
      throw new Error(
        `The volume has no ids of ${account}; run configure --cluster on the primary`,
      );
    await ensureAccount(account, ids);
  }
  for (const entry of await readdir(join(kit(root), 'units'), { withFileTypes: true }))
    if (entry.isDirectory()) {
      await mkdir(join(UNITS, entry.name), { recursive: true });
      for (const dropIn of await readdir(join(kit(root), 'units', entry.name)))
        await copyFile(
          join(kit(root), 'units', entry.name, dropIn),
          join(UNITS, entry.name, dropIn),
        );
    } else await copyFile(join(kit(root), 'units', entry.name), join(UNITS, entry.name));
  await disableAutostart();
  await writeNodeMarker({ root, resource });
  report(
    'info',
    `This node can run ${resource}; Pacemaker starts Arkvory where the volume is primary`,
  );
}

/** Undoes the node marker and the replica unit; used when configuring a cluster fails. */
export async function leaveCluster(root: string): Promise<void> {
  await rm(NODE_MARKER, { force: true });
  await rm(join(root, 'config', 'cluster.json'), { force: true });
  await command('systemctl', ['stop', 'arkvory-replica']).catch(() => undefined);
  await rm(join(UNITS, 'arkvory-replica.service'), { force: true });
  await command('systemctl', ['daemon-reload']);
}

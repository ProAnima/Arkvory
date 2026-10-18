import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, atomicText, exists, jsonFile } from './files.js';
import { command, commandOutput } from './process.js';
import { report } from './output.js';
import { installKitUnits, readKitFile } from './cluster-kit.js';
import { JOIN_WITH_KIT, mounted, ownMount, releaseVolume, takeVolume } from './cluster-volume.js';
import type { VolumeGuard } from './cluster-volume.js';

/**
 * A node of an HA cluster (ADR 0072) is marked outside the replicated volume: install, update and
 * package scripts read it to leave starting and stopping to Pacemaker.
 */
export const NODE_MARKER = '/etc/proanima-arkvory/cluster.json';
const UNITS = '/etc/systemd/system';
/** Every unit Pacemaker starts in the group; none of them is enabled on a cluster node. */
export const CLUSTER_UNITS = [
  'arkvory-units.service',
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
  // The group as configured: `crm_resource --list-raw` names its members, not the group.
  const resources = await commandOutput('cibadmin', ['--query', '--scope', 'resources']);
  return resources.includes(`<group id="${marker.resource}"`) ? marker.resource : null;
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
UnsetEnvironment=NODE_PATH
Restart=always
RestartSec=2
`;
}

/** The first unit of the group: brings this node's units up to the volume's before the rest. */
export function unitsUnit(root: string): string {
  return `[Unit]
Description=ProAnima Arkvory units of the active node (ADR 0072)
# Arkvory installation: ${root}
[Service]
Type=oneshot
RemainAfterExit=yes
User=root
ExecStart=/usr/bin/arkvory cluster-units --root ${root}
UnsetEnvironment=NODE_PATH
`;
}

/** Copies when the bytes differ; true when it copied. */
async function copyChanged(from: string, to: string): Promise<boolean> {
  const [source, target] = await Promise.all([readFile(from), readFile(to).catch(() => null)]);
  if (target !== null && source.equals(target)) return false;
  await copyFile(from, to);
  return true;
}

/**
 * The Arkvory units of one directory into another, drop-ins included; a drop-in the source no
 * longer has is removed. Returns whether anything changed.
 */
export async function mirrorUnits(from: string, to: string): Promise<boolean> {
  let changed = false;
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.name.startsWith('arkvory-')) continue;
    if (!entry.isDirectory()) {
      changed = (await copyChanged(join(from, entry.name), join(to, entry.name))) || changed;
      continue;
    }
    await mkdir(join(to, entry.name), { recursive: true });
    const dropIns = await readdir(join(from, entry.name));
    for (const dropIn of dropIns)
      changed =
        (await copyChanged(join(from, entry.name, dropIn), join(to, entry.name, dropIn))) ||
        changed;
    for (const stale of await readdir(join(to, entry.name)))
      if (!dropIns.includes(stale)) {
        await rm(join(to, entry.name, stale), { force: true });
        changed = true;
      }
  }
  return changed;
}

/**
 * What every other node needs, kept on the volume: the accounts' ids (files on the volume are
 * owned by them) and the units, so a standby starts exactly what the primary ran. Written when
 * the cluster is configured and after every later operation on the active node (an update, a
 * backup vault configured afterwards), so a failover never starts older units than those.
 */
export async function writeNodeKit(root: string): Promise<void> {
  const accounts: Record<string, { uid: number; gid: number }> = {};
  for (const account of ACCOUNTS)
    accounts[account] = { uid: await idOf('-u', account), gid: await idOf('-g', account) };
  await mkdir(join(kit(root), 'units'), { recursive: true });
  // Unchanged files are not written again: this runs after every update check.
  const written = await readFile(join(kit(root), 'accounts.json'), 'utf8').catch(() => '');
  if (written !== JSON.stringify(accounts, null, 2) + '\n')
    await atomicJson(join(kit(root), 'accounts.json'), accounts);
  for (const [name, text] of [
    ['arkvory-replica.service', replicaUnit(root)],
    ['arkvory-units.service', unitsUnit(root)],
  ] as const)
    if ((await readFile(join(UNITS, name), 'utf8').catch(() => '')) !== text)
      await atomicText(join(UNITS, name), text);
  await mirrorUnits(UNITS, join(kit(root), 'units'));
}

/** After an operation on the active node of a cluster: the kit follows what it changed. */
export async function refreshNodeKit(root: string): Promise<void> {
  const marker = await nodeMarker();
  if (marker?.root === root && (await exists(join(kit(root), 'accounts.json'))))
    await writeNodeKit(root);
}

/**
 * `arkvory cluster-units` (the arkvory-units service, first in the group after the file system):
 * this node's units become those on the volume, so the node that takes over runs what the
 * previous active node ran, settings changed after it joined included.
 */
export async function syncUnits(root: string): Promise<void> {
  if (await mirrorUnits(join(kit(root), 'units'), UNITS))
    await command('systemctl', ['daemon-reload']);
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

type Accounts = Readonly<
  Record<string, { readonly uid: number; readonly gid: number } | undefined>
>;

/** The same accounts with the same ids and the same units as the cluster, none enabled. */
async function prepareNode(accounts: Accounts, install: (units: string) => Promise<unknown>) {
  for (const account of ACCOUNTS) {
    const ids = accounts[account];
    if (!ids || !Number.isInteger(ids.uid) || !Number.isInteger(ids.gid))
      throw new Error(
        `The cluster has no ids of ${account}; run configure --cluster on the first node`,
      );
    await ensureAccount(account, ids);
  }
  await install(UNITS);
  await disableAutostart();
}

/** The cluster settings on the mounted volume; a volume not yet clustered says so. */
async function volumeSettings(root: string): Promise<{ readonly resource: string }> {
  const settings = (await jsonFile(join(root, 'config', 'cluster.json')).catch(() => null)) as {
    resource?: unknown;
  } | null;
  if (typeof settings?.resource !== 'string')
    throw new Error(
      'The volume is not a cluster yet: run "arkvory configure --cluster" on the first node',
    );
  return { resource: settings.resource };
}

/**
 * `arkvory cluster-node`: prepares another data node, the same accounts with the same ids and
 * the same units, none enabled. With `--kit` (written by cluster-kit on the active node) the
 * volume is not needed, so a replacement node joins while the active node keeps serving. Without,
 * while the cluster is built (Pacemaker does not manage it yet), the node takes the volume, reads
 * what it needs and releases it again. While the volume is mounted here, `guard` holds the
 * installation's operation lock, which lives on the volume.
 */
export async function joinNode(
  root: string,
  resource: string | undefined,
  kitFile?: string,
  guard: VolumeGuard = (work) => work(),
): Promise<void> {
  if (kitFile !== undefined) {
    const nodeKit = await readKitFile(kitFile);
    if (resource !== undefined && resource !== nodeKit.resource)
      throw new Error(`The kit is of ${nodeKit.resource}, not of ${resource}`);
    if (nodeKit.root !== root) throw new Error(`The kit is for --root ${nodeKit.root}`);
    await prepareNode(nodeKit.accounts, (units) => installKitUnits(nodeKit, units));
    await writeNodeMarker({ root, resource: nodeKit.resource });
    report('info', `This node can run ${nodeKit.resource} once DRBD and Pacemaker know it`);
    return;
  }
  const name = resource ?? 'arkvory';
  // Mounted here already: a node of the cluster holds it (release first), or an earlier run
  // failed before it released it; that one is taken over and released at the end. Anything
  // else mounted there (a plain data disk) is refused before the try: it is never released.
  const held = await mounted(root);
  if (held && (await exists(NODE_MARKER)))
    throw new Error(
      `This node holds the volume as a cluster node: run "arkvory cluster-release --root ${root}" first`,
    );
  if (held) await ownMount(root, name);
  else await takeVolume(root, name, JOIN_WITH_KIT);
  let failure: Error | undefined;
  try {
    await guard(async () => {
      await replicatedMount(root);
      const settings = await volumeSettings(root);
      if (settings.resource !== name)
        throw new Error(
          `The volume belongs to ${settings.resource}; pass --cluster-resource ${settings.resource}`,
        );
      const accounts = (await jsonFile(join(kit(root), 'accounts.json'))) as Accounts;
      await prepareNode(accounts, (units) => mirrorUnits(join(kit(root), 'units'), units));
      await writeNodeMarker({ root, resource: name });
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  // The volume is released whatever happened, and the first failure is the one reported.
  try {
    await releaseVolume(root, name, { instead: JOIN_WITH_KIT, guard });
  } catch (error) {
    if (failure === undefined) throw error;
    report(
      'warning',
      `Releasing the volume failed too: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  if (failure !== undefined) throw failure;
  report('info', `This node can run ${name}; Pacemaker starts Arkvory where the volume is primary`);
}

/** Undoes the node marker and the replica unit; used when configuring a cluster fails. */
export async function leaveCluster(root: string): Promise<void> {
  await rm(NODE_MARKER, { force: true });
  await rm(join(root, 'config', 'cluster.json'), { force: true });
  await command('systemctl', ['stop', 'arkvory-replica']).catch(() => undefined);
  await rm(join(UNITS, 'arkvory-replica.service'), { force: true });
  await rm(join(UNITS, 'arkvory-units.service'), { force: true });
  await command('systemctl', ['daemon-reload']);
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, exists, replaceText } from './files.js';
import type { Installation } from './model.js';
import { command } from './process.js';
import { report } from './output.js';
import { runtimeEnvironment } from './runtime.js';
import type { ServiceControl } from './tls-setup.js';
import { clusterFile, readVolume } from './replica-service.js';
import type { ClusterSettings } from './replica-service.js';
import {
  NODE_MARKER,
  disableAutostart,
  leaveCluster,
  replicatedMount,
  writeNodeKit,
  writeNodeMarker,
} from './cluster-node.js';

const SOCKET = '/run/arkvory/replica.sock';

export interface ClusterChange {
  readonly profile: 'ha-2' | 'ha-3';
  readonly resource: string;
}

export function clusterChange(options: ReadonlyMap<string, string>): ClusterChange {
  const profile = options.get('cluster');
  if (profile !== 'ha-2' && profile !== 'ha-3') throw new Error('--cluster takes ha-2 or ha-3');
  const resource = options.get('cluster-resource') ?? 'arkvory';
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(resource)) throw new Error('Invalid --cluster-resource');
  return { profile, resource };
}

/**
 * `arkvory configure --cluster ha-2|ha-3` on the node where the volume is primary (ADR 0072):
 * checks that the root is the replicated volume and that both copies are complete, then makes the
 * API acknowledge writes only with enough copies, keeps on the volume what other nodes need, and
 * leaves starting the services to Pacemaker. Any failure restores the standalone configuration.
 */
export async function configureCluster(
  root: string,
  state: Installation,
  change: ClusterChange,
  services: ServiceControl,
): Promise<void> {
  if (state.mode !== 'systemd')
    throw new Error('HA clusters are for native Linux installations (ADR 0072)');
  // A second run would roll a working node back to standalone on any failure.
  if ((await exists(NODE_MARKER)) || (await exists(clusterFile(root))))
    throw new Error(
      'This installation is a cluster node already; configure --cluster runs once, on the first node. Check it with "arkvory cluster-check"',
    );
  await replicatedMount(root);
  const volume = await readVolume(change.resource);
  if (volume.role !== 'Primary') throw new Error(`${change.resource} is not primary on this node`);
  if (volume.copies < 2)
    throw new Error(
      `${change.resource} has ${String(volume.copies)} complete copies; wait for the resynchronization`,
    );
  const settings: ClusterSettings = {
    profile: change.profile,
    resource: change.resource,
    requiredCopies: 2,
    socket: SOCKET,
  };
  const runtimePath = join(root, 'config/runtime.json');
  const previous = await readFile(runtimePath, 'utf8');
  const next = { ...runtimeEnvironment(JSON.parse(previous)), ARKVORY_REPLICA_SOCKET: SOCKET };
  try {
    await atomicJson(clusterFile(root), settings);
    await writeNodeKit(root);
    await command('systemctl', ['daemon-reload']);
    await command('systemctl', ['start', 'arkvory-replica']);
    await replaceText(runtimePath, JSON.stringify(next, null, 2) + '\n');
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    await disableAutostart();
    await writeNodeMarker({ root, resource: change.resource });
  } catch (error) {
    await replaceText(runtimePath, previous);
    await leaveCluster(root);
    await command('systemctl', [
      'enable',
      'arkvory-database',
      'arkvory-api',
      'arkvory-worker',
      'arkvory-backup',
      'arkvory-update.timer',
    ]);
    await services.stop();
    await services.start(state.current);
    await services.healthy();
    throw new Error(
      `The cluster was not configured; the standalone configuration is restored (${error instanceof Error ? error.message : 'failed'})`,
      { cause: error },
    );
  }
  report('info', nextSteps(root, change));
}

/** The literal commands that follow, in the order of the cluster page (wiki operate/cluster). */
export function nextSteps(root: string, change: ClusterChange): string {
  const resource = change.resource === 'arkvory' ? '' : ` --cluster-resource ${change.resource}`;
  return [
    `Writes are now acknowledged only with 2 complete copies (${change.profile}). Next:`,
    `  1. On this node, release the volume:  arkvory cluster-release --root ${root}`,
    `  2. On each other data node in turn:   arkvory cluster-node --root ${root}${resource}`,
    '     then, with the .deb package only:  dpkg --configure proanima-arkvory',
    '  3. Set up Corosync with pcs (pcs host auth, pcs cluster setup, pcs cluster start --all)',
    ...(change.profile === 'ha-2'
      ? ['     and on the witness:              systemctl enable --now corosync-qnetd']
      : []),
    '  4. Fill the fence parameters in pacemaker.sh of your plan and run it on one data node',
    `  5. On the active node:                  arkvory cluster-check --root ${root}`,
  ].join('\n');
}

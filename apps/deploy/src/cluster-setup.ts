import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, replaceText } from './files.js';
import type { Installation } from './model.js';
import { command } from './process.js';
import { report } from './output.js';
import { runtimeEnvironment } from './runtime.js';
import type { ServiceControl } from './tls-setup.js';
import { clusterFile, readVolume } from './replica-service.js';
import type { ClusterSettings } from './replica-service.js';
import {
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
  report(
    'info',
    `Writes are acknowledged with ${String(settings.requiredCopies)} complete copies. Next: on every other data node, mount the volume during a planned switchover and run "arkvory cluster-node --root ${root} --cluster-resource ${change.resource}"; then apply "arkvory cluster-plan" with Pacemaker.`,
  );
}

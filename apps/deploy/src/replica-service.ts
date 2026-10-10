import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, jsonFile, exists } from './files.js';
import { commandOutput } from './process.js';
import { report } from './output.js';
import {
  FreshReads,
  MAX_SINGLE_COPY_MS,
  parseDecision,
  replicaAnswer,
  volumeState,
} from './replica-state.js';
import type { SingleCopyDecision, VolumeState } from './replica-state.js';

/** One local query; slower than this, the state is unknown and writes are refused. */
const DRBDSETUP_TIMEOUT_MS = 1500;

/** Cluster settings written by `arkvory configure --cluster` (config/cluster.json). */
export interface ClusterSettings {
  readonly profile: 'ha-2' | 'ha-3';
  readonly resource: string;
  readonly requiredCopies: number;
  readonly socket: string;
}

export function parseCluster(value: unknown): ClusterSettings {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid cluster settings');
  const { profile, resource, requiredCopies, socket } = value as Record<string, unknown>;
  if (
    (profile !== 'ha-2' && profile !== 'ha-3') ||
    typeof resource !== 'string' ||
    !/^[a-z][a-z0-9-]{0,30}$/.test(resource) ||
    requiredCopies !== 2 ||
    typeof socket !== 'string' ||
    !socket.startsWith('/run/')
  )
    throw new Error('Invalid cluster settings');
  return { profile, resource, requiredCopies, socket };
}

export const clusterFile = (root: string) => join(root, 'config', 'cluster.json');
/** On the replicated volume: the decision follows the active role through a failover. */
export const decisionFile = (root: string) => join(root, 'config', 'single-copy.json');

export async function readDecision(root: string): Promise<SingleCopyDecision | null> {
  return (await exists(decisionFile(root)))
    ? parseDecision(await jsonFile(decisionFile(root)))
    : null;
}

/** The kernel's state of the resource, read now. */
export async function readVolume(resource: string): Promise<VolumeState> {
  const output = await commandOutput(
    'drbdsetup',
    ['status', '--json', resource],
    undefined,
    undefined,
    { timeoutMs: DRBDSETUP_TIMEOUT_MS },
  );
  return volumeState(JSON.parse(output) as unknown, resource);
}

/**
 * The `arkvory-replica` service: `GET /state` on a local socket answers the copies the kernel
 * reports after the request arrived (FreshReads) and the copies a write needs, lowered to one by
 * a valid operator decision. Any failure answers 503: the API then refuses to acknowledge.
 */
export function replicaServer(
  read: () => Promise<VolumeState>,
  settings: ClusterSettings,
  decision: () => Promise<SingleCopyDecision | null>,
  now: () => number = Date.now,
): Server {
  const reads = new FreshReads(read);
  return createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/state') {
      response.writeHead(404).end();
      return;
    }
    Promise.all([reads.get(), decision()])
      .then(([volume, chosen]) => {
        const body = replicaAnswer(volume.copies, settings.requiredCopies, chosen, now());
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        report(
          'warning',
          `Replica state unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        response.writeHead(503).end();
      });
  });
}

export async function serveReplica(root: string): Promise<void> {
  const settings = parseCluster(await jsonFile(clusterFile(root)));
  // A socket left by a crashed run would refuse the listen; systemd owns the runtime directory.
  await rm(settings.socket, { force: true });
  const server = replicaServer(
    () => readVolume(settings.resource),
    settings,
    () => readDecision(root),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.socket, resolve);
  });
  report('info', `Replica state served for ${settings.resource} (${settings.profile})`);
  await new Promise<void>((resolve) => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
      process.once(signal, () => {
        server.close(() => {
          resolve();
        });
      });
  });
}

/** `arkvory cluster-status`: the profile, this node's role, copies and any decision, as JSON. */
export async function clusterStatus(root: string): Promise<void> {
  const settings = parseCluster(await jsonFile(clusterFile(root)));
  const decision = await readDecision(root);
  const volume = await readVolume(settings.resource);
  console.log(
    JSON.stringify({
      profile: settings.profile,
      resource: settings.resource,
      role: volume.role,
      ...replicaAnswer(volume.copies, settings.requiredCopies, decision, Date.now()),
      decision,
    }),
  );
}

/** `arkvory cluster-single-copy`: accept one copy until a time, or (`--off`) withdraw it. */
export async function decideSingleCopy(
  root: string,
  options: ReadonlyMap<string, string>,
  now = Date.now(),
): Promise<void> {
  parseCluster(await jsonFile(clusterFile(root)));
  if (options.has('off')) {
    await rm(decisionFile(root), { force: true });
    report('warning', 'Single-copy decision withdrawn: writes need every required copy again');
    return;
  }
  const until = Date.parse(options.get('until') ?? '');
  if (Number.isNaN(until) || until <= now || until - now > MAX_SINGLE_COPY_MS)
    throw new Error('--until must be a time in the next 7 days (ISO 8601)');
  const decision = parseDecision({
    until: new Date(until).toISOString(),
    reason: options.get('reason') ?? '',
    decidedAt: new Date(now).toISOString(),
  });
  await atomicJson(decisionFile(root), decision);
  report(
    'warning',
    `Writes are acknowledged with ONE copy until ${decision.until}: a second failure loses them. Reason: ${decision.reason}`,
  );
}

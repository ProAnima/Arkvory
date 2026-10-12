import { setTimeout as delay } from 'node:timers/promises';
import { commandOutput } from './process.js';
import { report } from './output.js';
import { completeCopies, peerNames, volumeState } from './replica-state.js';

import { nodeMarker } from './cluster-node.js';

/** Runs a cluster tool and returns its output; rejects on a non-zero exit. */
export type Tool = (executable: string, args: string[], timeoutMs?: number) => Promise<string>;

export const systemTool: Tool = (executable, args, timeoutMs = 30000) =>
  commandOutput(executable, args, undefined, undefined, { timeoutMs });

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const failed = (error: unknown) => (error instanceof Error ? error.message : 'failed');

/** `crm_attribute` exits non-zero for an unset property; Pacemaker then uses its default. */
async function property(tool: Tool, name: string, fallback: string): Promise<string> {
  try {
    return (
      await tool('crm_attribute', ['--type', 'crm_config', '--name', name, '--query', '--quiet'])
    ).trim();
  } catch {
    return fallback;
  }
}

/** Pacemaker node names from `crm_node -l` lines: `<id> <name> <state>`. */
export function clusterNodes(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter(Boolean);
}

/** Where the group runs, from `crm_resource --locate`: `resource X is running on: node`. */
export function locatedOn(output: string): string[] {
  return [...output.matchAll(/is running on: (\S+)/g)].map((match) => match[1] ?? '');
}

async function fencingChecks(tool: Tool): Promise<CheckResult[]> {
  const stonith = await property(tool, 'stonith-enabled', 'true');
  const policy = await property(tool, 'no-quorum-policy', 'stop');
  const results: CheckResult[] = [
    { name: 'stonith-enabled', ok: stonith === 'true', detail: stonith },
    { name: 'no-quorum-policy', ok: policy === 'stop' || policy === 'freeze', detail: policy },
  ];
  for (const node of clusterNodes(await tool('crm_node', ['-l']))) {
    const devices = await tool('stonith_admin', ['--list', node]).catch(() => '');
    const names = devices
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/devices found/.test(line));
    results.push({
      name: `fence ${node}`,
      ok: names.length > 0,
      detail: names.length > 0 ? names.join(', ') : 'no fence device can fence this node',
    });
  }
  return results;
}

async function replicationChecks(tool: Tool, resource: string): Promise<CheckResult[]> {
  const shown = await tool('drbdsetup', ['show', resource]);
  const volume = volumeState(
    JSON.parse(await tool('drbdsetup', ['status', '--json', resource])),
    resource,
  );
  return [
    { name: 'drbd quorum', ok: /quorum\s+majority;/.test(shown), detail: 'quorum majority' },
    {
      name: 'drbd fencing',
      ok: /fencing\s+resource-and-stonith;/.test(shown),
      detail: 'fencing resource-and-stonith',
    },
    {
      name: 'complete copies',
      ok: volume.copies >= 2,
      detail: `${String(volume.copies)} (${volume.role} here)`,
    },
  ];
}

/**
 * The shape of the cluster: 2 data nodes with a quorum device (ha-2) or 3 (ha-3), so 3 votes
 * either way; Pacemaker's names are this node's and DRBD's peers'; clocks follow NTP (the
 * single-copy decision on the volume is judged by the active node's clock).
 */
async function shapeChecks(tool: Tool, resource: string, quorum: string): Promise<CheckResult[]> {
  const nodes = clusterNodes(await tool('crm_node', ['-l']));
  const votes = /Expected votes:\s+(\d+)/.exec(quorum)?.[1] ?? 'unknown';
  const here = (await tool('crm_node', ['-n'])).trim();
  const peers = peerNames(
    JSON.parse(await tool('drbdsetup', ['status', '--json', resource])),
    resource,
  );
  const strangers = nodes.filter((node) => node !== here && !peers.includes(node));
  const synced = (
    await tool('timedatectl', ['show', '-p', 'NTPSynchronized', '--value']).catch(() => 'unknown')
  ).trim();
  const results: CheckResult[] = [
    {
      name: 'data nodes',
      ok: nodes.length === 2 || nodes.length === 3,
      detail: `${String(nodes.length)} (ha-2 has 2 and a witness, ha-3 has 3)`,
    },
    { name: 'votes', ok: votes === '3', detail: `${votes} expected, 3 needed` },
    {
      name: 'names agree',
      ok: strangers.length === 0,
      detail:
        strangers.length === 0
          ? 'Pacemaker and DRBD know the same nodes'
          : `${strangers.join(', ')} not in DRBD resource ${resource}: names must equal the host names`,
    },
    { name: 'clock synchronized', ok: synced === 'yes', detail: `NTPSynchronized=${synced}` },
  ];
  if (nodes.length === 2)
    results.push({
      name: 'witness',
      ok: /Flags:.*\bQdevice\b/.test(quorum),
      detail: /Flags:.*\bQdevice\b/.test(quorum) ? 'quorum device votes' : 'no quorum device vote',
    });
  return results;
}

/** Every requirement of ADR 0072 a running cluster must meet; one failed check fails the whole. */
export async function clusterChecks(tool: Tool, resource: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const quorum = await tool('corosync-quorumtool', ['-s']).catch((error: unknown) => failed(error));
  results.push({
    name: 'quorum',
    ok: /Quorate:\s+Yes/.test(quorum),
    detail: /Quorate:\s+(\S+)/.exec(quorum)?.[1] ?? 'unknown',
  });
  try {
    results.push(...(await shapeChecks(tool, resource, quorum)));
  } catch (error) {
    results.push({ name: 'cluster shape', ok: false, detail: failed(error) });
  }
  for (const part of [() => fencingChecks(tool), () => replicationChecks(tool, resource)])
    try {
      results.push(...(await part()));
    } catch (error) {
      results.push({ name: 'cluster tools', ok: false, detail: failed(error) });
    }
  const located = locatedOn(
    await tool('crm_resource', ['--resource', resource, '--locate']).catch(() => ''),
  );
  results.push({
    name: 'active node',
    ok: located.length === 1,
    detail: located.length ? located.join(', ') : 'Arkvory is not running',
  });
  return results;
}

async function requireMarker() {
  const marker = await nodeMarker();
  if (!marker)
    throw new Error('This is not an Arkvory cluster node (configure --cluster or cluster-node)');
  return marker;
}

/** `arkvory cluster-check`: prints every check; fails when one does. */
export async function checkCluster(tool: Tool = systemTool): Promise<void> {
  const { resource } = await requireMarker();
  const results = await clusterChecks(tool, resource);
  for (const result of results)
    report(
      result.ok ? 'info' : 'error',
      `${result.ok ? 'ok' : 'FAILED'} ${result.name}: ${result.detail}`,
    );
  const failures = results.filter((result) => !result.ok).length;
  if (failures > 0) throw new Error(`${String(failures)} cluster checks failed`);
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(2000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * `arkvory cluster-switchover --to <node>`: a planned move of the active role. Pacemaker moves the
 * group by a temporary location constraint, which is cleared once Arkvory runs there; refused
 * unless the target itself holds a complete copy, so it holds every acknowledged write. (In ha-3
 * two other complete copies would not do: the target may still be resynchronizing.)
 */
export async function switchover(
  target: string | undefined,
  tool: Tool = systemTool,
): Promise<void> {
  const { resource } = await requireMarker();
  if (!target) throw new Error('--to names the node to move Arkvory to');
  if (!clusterNodes(await tool('crm_node', ['-l'])).includes(target))
    throw new Error(`${target} is not a cluster node`);
  const located = locatedOn(await tool('crm_resource', ['--resource', resource, '--locate']));
  if (located.includes(target)) throw new Error(`Arkvory already runs on ${target}`);
  const copies = completeCopies(
    JSON.parse(await tool('drbdsetup', ['status', '--json', resource])),
    resource,
  );
  const here = (await tool('crm_node', ['-n'])).trim();
  const status: unknown = JSON.parse(await tool('drbdsetup', ['status', '--json', resource]));
  if (target !== here && !peerNames(status, resource).includes(target))
    throw new Error(
      `${target} is no DRBD peer of ${resource}: the Pacemaker and DRBD node names must equal the host names (arkvory cluster-check)`,
    );
  const complete = target === here ? copies.local : copies.peers.includes(target);
  if (!complete || (copies.local ? 1 : 0) + copies.peers.length < 2)
    throw new Error(
      `${target} has no complete copy yet; wait for the resynchronization before a switchover`,
    );
  await tool('crm_resource', ['--resource', resource, '--move', '--node', target]);
  try {
    await waitFor(
      async () =>
        locatedOn(
          await tool('crm_resource', ['--resource', resource, '--locate']).catch(() => ''),
        ).includes(target),
      300000,
      `${resource} on ${target}`,
    );
  } finally {
    // The constraint would pin Arkvory to the target and block a later failover back.
    await tool('crm_resource', ['--resource', resource, '--clear']);
  }
  report('info', `Arkvory runs on ${target}`);
}

/**
 * `arkvory cluster-fence-test --node <node>`: fences a standby to prove its fence device works.
 * The active node is refused: fencing it is a failover, which cluster-switchover does safely.
 */
export async function fenceTest(
  node: string | undefined,
  confirmed: boolean,
  tool: Tool = systemTool,
): Promise<void> {
  const { resource } = await requireMarker();
  if (!node) throw new Error('--node names the standby to fence');
  const nodes = clusterNodes(await tool('crm_node', ['-l']));
  if (!nodes.includes(node)) throw new Error(`${node} is not a cluster node`);
  if (locatedOn(await tool('crm_resource', ['--resource', resource, '--locate'])).includes(node))
    throw new Error(`${node} runs Arkvory; fence a standby or switch over first`);
  // With a vote missing already, fencing one more node loses the quorum and stops the service.
  const failing = (await clusterChecks(tool, resource)).filter((check) => !check.ok);
  if (failing.length > 0)
    throw new Error(
      `Fix the cluster before a fencing test: ${failing.map((check) => check.name).join(', ')} failed (arkvory cluster-check)`,
    );
  if (nodes.length === 2 && !confirmed)
    throw new Error(
      `In ha-2 writes stop (503) until ${node} is back and resynchronized; repeat with --yes to fence it`,
    );
  // The fencer may take its whole 120 s (IPMI and Redfish reboots are slow): wait for its answer.
  await tool('stonith_admin', ['--reboot', node, '--timeout', '120'], 150_000);
  report('info', `${node} was fenced; it rejoins after its restart and resynchronizes`);
}

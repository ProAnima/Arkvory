import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { atomicText } from './files.js';
import { report } from './output.js';
import { drbdResource, pacemakerCommands } from './cluster-plan.js';
import type { ClusterNode, ClusterPlanInput } from './cluster-plan.js';

const DEFAULT_ROOT = '/opt/proanima-arkvory';

/** `a=10.0.0.1,b=10.0.0.2`: names and addresses in DRBD node-id order, from `first`. */
export function parseNodes(value: string | undefined, first = 0): ClusterNode[] {
  if (!value) throw new Error('--nodes lists the data nodes: name=address,…');
  return value.split(',').map((entry, index) => {
    const [name = '', address = '', extra] = entry.trim().split('=');
    if (!name || !address || extra !== undefined) throw new Error(`Invalid node entry ${entry}`);
    return { name, address, id: first + index };
  });
}

export function planInput(options: ReadonlyMap<string, string>): ClusterPlanInput {
  const profile = options.get('cluster');
  if (profile !== 'ha-2' && profile !== 'ha-3') throw new Error('--cluster takes ha-2 or ha-3');
  const nodes = parseNodes(options.get('nodes'));
  const witness = options.get('witness');
  const [virtualIp = '', mask = ''] = (options.get('virtual-ip') ?? '').split('/');
  const filesystem = options.get('filesystem') ?? 'xfs';
  if (filesystem !== 'xfs' && filesystem !== 'ext4') throw new Error('--filesystem is xfs or ext4');
  return {
    profile,
    resource: options.get('cluster-resource') ?? 'arkvory',
    root: options.get('root') ?? DEFAULT_ROOT,
    disk: options.get('disk') ?? '',
    minor: Number(options.get('drbd-minor') ?? '0'),
    port: Number(options.get('drbd-port') ?? '7789'),
    filesystem,
    nodes,
    ...(witness ? { witness: parseNodes(witness, nodes.length)[0] as ClusterNode } : {}),
    fenceAgent: options.get('fence-agent') ?? '',
    virtualIp,
    netmask: Number(mask),
  };
}

/** `arkvory cluster-plan`: writes the two files to review; applies nothing. */
export async function writePlan(options: ReadonlyMap<string, string>): Promise<void> {
  const output = options.get('output');
  if (!output || !isAbsolute(output)) throw new Error('--output takes an absolute directory');
  const input = planInput(options);
  await mkdir(output, { recursive: true });
  const resource = join(output, `${input.resource}.res`);
  const pacemaker = join(output, 'pacemaker.sh');
  await atomicText(resource, drbdResource(input));
  await atomicText(pacemaker, pacemakerCommands(input));
  report(
    'info',
    `Review ${resource} (copy to /etc/drbd.d/ on every node, the witness included) and ${pacemaker} (fill the fence agent's parameters, run on one node)`,
  );
}

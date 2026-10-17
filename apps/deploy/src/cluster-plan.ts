/**
 * The cluster configuration an operator reviews and applies (ADR 0072): the DRBD resource and
 * the Pacemaker commands. Fencing parameters belong to the site (addresses, credentials), so the
 * plan names the agent and leaves those values for the operator; nothing here is applied.
 */
export interface ClusterNode {
  readonly name: string;
  readonly address: string;
  /** DRBD node id, 0-based, unique in the resource. */
  readonly id: number;
}

export interface ClusterPlanInput {
  readonly profile: 'ha-2' | 'ha-3';
  readonly resource: string;
  readonly root: string;
  /** Backing disk of the volume on every data node, e.g. /dev/vg0/arkvory. */
  readonly disk: string;
  readonly minor: number;
  readonly port: number;
  readonly filesystem: 'xfs' | 'ext4';
  readonly nodes: readonly ClusterNode[];
  /** ha-2: the diskless tiebreaker and corosync-qnetd host; absent in ha-3. */
  readonly witness?: ClusterNode;
  readonly fenceAgent: string;
  readonly virtualIp: string;
  readonly netmask: number;
}

const NAME = /^[a-z][a-z0-9-]{0,62}$/;
/** IPv4 only: DRBD writes IPv6 differently, and IPaddr2 is the IPv4 agent. */
const ipv4 = (value: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255);
const within = (value: number, low: number, high: number) =>
  Number.isInteger(value) && value >= low && value <= high;
const AGENT = /^fence_[a-z0-9_]{2,40}$/;
/** The rule of configure --cluster and cluster-node: the plan never names what they refuse. */
const RESOURCE = /^[a-z][a-z0-9-]{0,30}$/;

export function checkPlan(input: ClusterPlanInput): void {
  const data = input.profile === 'ha-2' ? 2 : 3;
  if (input.nodes.length !== data)
    throw new Error(`${input.profile} needs exactly ${String(data)} data nodes`);
  if (input.profile === 'ha-2' && !input.witness)
    throw new Error('ha-2 needs a witness: two votes cannot tell a failure from a partition');
  if (input.profile === 'ha-3' && input.witness)
    throw new Error('ha-3 decides by majority of its three data nodes; it takes no witness');
  const all = [...input.nodes, ...(input.witness ? [input.witness] : [])];
  if (new Set(all.map((node) => node.name)).size !== all.length)
    throw new Error('Node names repeat');
  if (new Set(all.map((node) => node.id)).size !== all.length) throw new Error('Node ids repeat');
  if (new Set(all.map((node) => node.address)).size !== all.length)
    throw new Error('Node addresses repeat');
  if (all.some((node) => node.address === input.virtualIp))
    throw new Error('The virtual address must differ from every node address');
  for (const node of all)
    if (!NAME.test(node.name) || !ipv4(node.address) || !within(node.id, 0, 31))
      throw new Error(`Invalid node ${node.name}`);
  if (!RESOURCE.test(input.resource))
    throw new Error('Invalid resource name: a lower-case letter, then up to 30 of a-z, 0-9 and -');
  if (!/^\/dev\/[A-Za-z0-9/_.-]+$/.test(input.disk)) throw new Error('Invalid backing disk');
  // Written unquoted into pacemaker.sh: only characters a shell takes literally.
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(input.root) || input.root.split('/').includes('..'))
    throw new Error('Invalid installation root');
  if (!AGENT.test(input.fenceAgent))
    throw new Error('A fence agent (fence_ipmilan, fence_redfish, fence_pve…) is required');
  if (!ipv4(input.virtualIp) || !within(input.netmask, 1, 32))
    throw new Error('Invalid virtual address');
  if (!within(input.minor, 0, 1048575) || !within(input.port, 1024, 65535))
    throw new Error('Invalid DRBD minor or port');
}

/**
 * The fence-peer handler. Pacemaker promotes only after the fence is confirmed; the handler's
 * default 90 s wait for the peer to look fenced would only delay the promotion (and outlast its
 * timeout), so it waits 20 s at most.
 *
 * ha-2: the handler counts every DRBD node outside UP_TO_DATE_NODES as a peer to fence. The
 * witness is diskless, so never up to date, and it is not a Pacemaker node: with no node state
 * in the CIB the handler takes it for a node Pacemaker is about to fence and polls for the whole
 * timeout on every promotion (20 s of each failover, ADR 0072). The witness holds no data and
 * the constraint names only the up-to-date nodes, so the handler runs without the witness's
 * node id; the data peers are still checked as before.
 */
function fencePeer(input: ClusterPlanInput): string {
  const handler = '/usr/lib/drbd/crm-fence-peer.9.sh --timeout 20';
  return input.witness ? `env -u DRBD_NODE_ID_${String(input.witness.id)} ${handler}` : handler;
}

/** The DRBD 9 resource: protocol C, fencing through Pacemaker, quorum by majority. */
export function drbdResource(input: ClusterPlanInput): string {
  checkPlan(input);
  const host = (node: ClusterNode, disk: string) =>
    `  on ${node.name} {\n    node-id ${String(node.id)};\n    address ${node.address}:${String(input.port)};\n    disk ${disk};\n    meta-disk internal;\n  }`;
  return [
    `# Arkvory HA volume (ADR 0072, profile ${input.profile}). Generated by arkvory cluster-plan.`,
    `resource ${input.resource} {`,
    `  device minor ${String(input.minor)};`,
    '  options {',
    // Without a quorum partition, IO fails at once: Pacemaker fences or moves the node instead
    // of a stale side writing alone.
    '    quorum majority;',
    '    on-no-quorum io-error;',
    '  }',
    '  net {',
    '    protocol C;',
    '    fencing resource-and-stonith;',
    '  }',
    // A returning copy must catch up under write load: the default floor (250 KiB/s) would keep
    // the cluster on fewer copies for hours. Tune both rates to the replication link.
    '  disk {',
    '    c-min-rate 20M;',
    '    c-max-rate 1G;',
    '  }',
    '  handlers {',
    `    fence-peer "${fencePeer(input)}";`,
    '    unfence-peer "/usr/lib/drbd/crm-unfence-peer.9.sh";',
    '  }',
    ...input.nodes.map((node) => host(node, input.disk)),
    ...(input.witness ? [host(input.witness, 'none')] : []),
    '  connection-mesh {',
    `    hosts ${[...input.nodes, ...(input.witness ? [input.witness] : [])].map((node) => node.name).join(' ')};`,
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Pacemaker: mandatory fencing, the promotable DRBD clone and one group started in order on its
 * primary — filesystem, PostgreSQL, the replica helper, Arkvory, the updater, the address. The
 * configuration is built in a CIB file and pushed at once: created one by one, resources would
 * start before their constraints exist.
 */
export function pacemakerCommands(input: ClusterPlanInput): string {
  checkPlan(input);
  const r = input.resource;
  const cib = `pcs -f ${r}.cib.xml`;
  const lines = [
    '#!/bin/sh',
    `# Arkvory HA (ADR 0072, profile ${input.profile}). Generated by arkvory cluster-plan.`,
    '# Review before running on ONE node of a configured, started cluster. Fill every <...>.',
    ...(input.witness
      ? [
          `# The witness ${input.witness.name} is not a Pacemaker node: it runs corosync-qnetd and the`,
          '# diskless DRBD tiebreaker (drbdadm up on boot), nothing of Arkvory.',
        ]
      : []),
    'set -eu',
    // Split so that this line itself never matches: only an unfilled placeholder stops the script.
    "if grep -q '<agent'' parameters' \"$0\"; then",
    "  echo 'Fill the fence agent parameters of every node in this script first' >&2",
    '  exit 1',
    'fi',
    `pcs cluster cib ${r}.cib.xml`,
    `${cib} property set stonith-enabled=true`,
    `${cib} property set no-quorum-policy=stop`,
    ...input.nodes.map(
      (node) =>
        `${cib} stonith create fence-${node.name} ${input.fenceAgent} pcmk_host_list=${node.name} <agent parameters: address, login, password or key file, plug>`,
    ),
    // The agent scores a standby for promotion in its monitor and after each notification. A
    // notification that lands while DRBD is still confirming the lost primary (the standby's
    // disk is Consistent for about a second) removes the score, and only the next standby
    // monitor restores it: its interval bounds that delay of the failover (29 s gave 79 s).
    `${cib} resource create ${r}-drbd ocf:linbit:drbd drbd_resource=${r} op monitor interval=15s role=Promoted op monitor interval=5s role=Unpromoted promotable promoted-max=1 promoted-node-max=1 clone-max=${String(input.nodes.length)} clone-node-max=1 notify=true`,
    `${cib} resource create ${r}-fs ocf:heartbeat:Filesystem device=/dev/drbd${String(input.minor)} directory=${input.root} fstype=${input.filesystem} --group ${r}`,
    `${cib} resource create ${r}-units systemd:arkvory-units --group ${r}`,
    `${cib} resource create ${r}-database systemd:arkvory-database op monitor interval=15s --group ${r}`,
    `${cib} resource create ${r}-replica systemd:arkvory-replica op monitor interval=15s --group ${r}`,
    ...['api', 'worker', 'backup'].map(
      (role) =>
        `${cib} resource create ${r}-${role} systemd:arkvory-${role} op monitor interval=15s op stop timeout=150s --group ${r}`,
    ),
    `${cib} resource create ${r}-update systemd:arkvory-update.timer --group ${r}`,
    `${cib} resource create ${r}-ip ocf:heartbeat:IPaddr2 ip=${input.virtualIp} cidr_netmask=${String(input.netmask)} op monitor interval=10s --group ${r}`,
    `${cib} constraint colocation add ${r} with Promoted ${r}-drbd-clone INFINITY`,
    `${cib} constraint order promote ${r}-drbd-clone then start ${r}`,
    `${cib} resource defaults update resource-stickiness=200`,
    `pcs cluster cib-push ${r}.cib.xml --config`,
    // After the push and only once: a second run must not fail on a device added before. The
    // configuration names a device only when there is one; the status output always has a
    // "Qdevice" column header, so it cannot tell.
    ...(input.witness
      ? [
          `pcs quorum config | grep -q '^Device:' || pcs quorum device add model net host=${input.witness.name} algorithm=ffsplit`,
        ]
      : []),
    '',
  ];
  return lines.join('\n');
}

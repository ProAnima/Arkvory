import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, drbdResource, pacemakerCommands } from '../apps/deploy/dist/cluster-plan.js';
import { parseNodes, planInput } from '../apps/deploy/dist/cluster-plan-files.js';
import { clusterChange } from '../apps/deploy/dist/cluster-setup.js';
import { replicaUnit } from '../apps/deploy/dist/cluster-node.js';

const options = (extra = {}) =>
  new Map(
    Object.entries({
      cluster: 'ha-2',
      nodes: 'node-a=10.0.0.1,node-b=10.0.0.2',
      witness: 'witness=10.0.0.3',
      disk: '/dev/vg0/arkvory',
      'fence-agent': 'fence_ipmilan',
      'virtual-ip': '10.0.0.10/24',
      ...extra,
    }),
  );

test('ha-2 plan: witness is diskless, gets the next node id and is not a Pacemaker node', () => {
  const input = planInput(options());
  assert.deepEqual(input.witness, { name: 'witness', address: '10.0.0.3', id: 2 });
  const resource = drbdResource(input);
  for (const line of [
    'quorum majority;',
    'on-no-quorum io-error;',
    'protocol C;',
    'fencing resource-and-stonith;',
    'c-min-rate 20M;',
    'crm-fence-peer.9.sh --timeout 20',
    'hosts node-a node-b witness;',
    'address 10.0.0.3:7789;\n    disk none;',
  ])
    assert.ok(resource.includes(line), line);
  const pacemaker = pacemakerCommands(input);
  assert.ok(pacemaker.includes('stonith-enabled=true'));
  assert.ok(pacemaker.includes('host=witness algorithm=ffsplit'));
  assert.ok(pacemaker.includes('clone-max=2'));
  assert.ok(!pacemaker.includes('fence-witness'), 'the witness is never fenced by Pacemaker');
  assert.ok(pacemaker.includes('directory=/opt/proanima-arkvory fstype=xfs'));
  // The group starts in order: the filesystem first, the address last.
  const order = ['-fs ', '-database ', '-replica ', '-api ', '-worker ', '-backup ', '-ip '].map(
    (name) => pacemaker.indexOf(`arkvory${name}`),
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test('ha-3 plan: three data nodes decide by majority, without a quorum device', () => {
  const pacemaker = pacemakerCommands(
    planInput(
      new Map([...options({ cluster: 'ha-3', nodes: 'a=10.0.0.1,b=10.0.0.2,c=10.0.0.3' })]).set(
        'witness',
        '',
      ),
    ),
  );
  assert.ok(!pacemaker.includes('quorum device'));
  assert.equal(pacemaker.match(/ stonith create /g)?.length, 3);
  // Resources and constraints reach the cluster in one push, never one by one.
  const lines = pacemaker.split('\n').filter((line) => line.startsWith('pcs '));
  assert.deepEqual(
    lines.filter((line) => !line.startsWith('pcs -f arkvory.cib.xml ')),
    ['pcs cluster cib arkvory.cib.xml', 'pcs cluster cib-push arkvory.cib.xml --config'],
  );
});

test('plans that cannot fence or decide a partition are refused', () => {
  const ha2 = planInput(options());
  assert.throws(() => checkPlan({ ...ha2, witness: undefined }), /needs a witness/);
  assert.throws(() => checkPlan({ ...ha2, profile: 'ha-3' }), /exactly 3/);
  assert.throws(() => checkPlan({ ...ha2, fenceAgent: '' }), /fence agent/);
  assert.throws(() => checkPlan({ ...ha2, fenceAgent: 'fence_x; rm -rf /' }), /fence agent/);
  assert.throws(() => checkPlan({ ...ha2, root: '/opt/a b' }), /installation root/);
  assert.throws(() => checkPlan({ ...ha2, disk: '/dev/sda;reboot' }), /backing disk/);
  assert.throws(
    () => checkPlan(planInput(options({ nodes: 'node-a=10.0.0.1,node-a=10.0.0.2' }))),
    /names repeat/,
  );
  assert.throws(() => checkPlan(planInput(options({ 'virtual-ip': '10.0.0.10' }))), /virtual/);
  assert.throws(() => parseNodes('node-a'), /Invalid node entry/);
  assert.throws(() => planInput(options({ filesystem: 'btrfs' })), /xfs or ext4/);
});

test('configure --cluster takes a profile and a safe resource name', () => {
  assert.deepEqual(clusterChange(new Map([['cluster', 'ha-3']])), {
    profile: 'ha-3',
    resource: 'arkvory',
  });
  assert.throws(() => clusterChange(new Map([['cluster', 'ha-1']])), /ha-2 or ha-3/);
  assert.throws(
    () =>
      clusterChange(
        new Map([
          ['cluster', 'ha-2'],
          ['cluster-resource', 'a;b'],
        ]),
      ),
    /Invalid --cluster-resource/,
  );
});

test('the replica unit runs as root, hands the socket to the arkvory group and has no install section', () => {
  const unit = replicaUnit('/opt/proanima-arkvory');
  assert.ok(unit.includes('User=root\nGroup=arkvory\nUMask=0007'));
  assert.ok(
    unit.includes('ExecStart=/usr/bin/arkvory cluster-replica --root /opt/proanima-arkvory'),
  );
  assert.ok(!unit.includes('[Install]'), 'Pacemaker starts it; nothing enables it');
});

const { clusterChecks, clusterNodes, locatedOn } =
  await import('../apps/deploy/dist/cluster-ops.js');
const drbdStatus = (peerDisk) =>
  JSON.stringify([
    {
      name: 'arkvory',
      role: 'Primary',
      devices: [{ volume: 0, 'disk-state': 'UpToDate' }],
      connections: [
        {
          'peer-node-id': 1,
          name: 'node-b',
          'connection-state': 'Connected',
          peer_devices: [
            {
              volume: 0,
              'replication-state': 'Established',
              'peer-disk-state': peerDisk,
              'peer-client': false,
            },
          ],
        },
      ],
    },
  ]);
// Outputs of the Pacemaker, Corosync and DRBD tools on a healthy ha-2 node.
const healthy = {
  'corosync-quorumtool -s': 'Quorum provider:  corosync_votequorum\nQuorate:          Yes\n',
  'crm_attribute stonith-enabled': 'true\n',
  'crm_attribute no-quorum-policy': 'stop\n',
  'crm_node -l': '1 node-a member\n2 node-b member\n',
  'stonith_admin --list node-a': 'fence-node-a\n1 fence device found\n',
  'stonith_admin --list node-b': 'fence-node-b\n1 fence device found\n',
  'drbdsetup show arkvory':
    'resource arkvory {\n  options {\n    quorum majority;\n  }\n  net {\n    fencing resource-and-stonith;\n  }\n}\n',
  'drbdsetup status --json arkvory': drbdStatus('UpToDate'),
  'crm_resource --resource arkvory --locate': 'resource arkvory is running on: node-a\n',
};
const toolOf = (outputs) => async (executable, args) => {
  const key =
    executable === 'crm_attribute' ? `crm_attribute ${args[3]}` : [executable, ...args].join(' ');
  if (!(key in outputs)) throw new Error(`${key} failed`);
  return outputs[key];
};

test('cluster-check passes a cluster that fences every node, has quorum and both copies', async () => {
  const results = await clusterChecks(toolOf(healthy), 'arkvory');
  assert.deepEqual(
    results.filter((result) => !result.ok),
    [],
  );
  assert.deepEqual(
    results.map((result) => result.name),
    [
      'quorum',
      'stonith-enabled',
      'no-quorum-policy',
      'fence node-a',
      'fence node-b',
      'drbd quorum',
      'drbd fencing',
      'complete copies',
      'active node',
    ],
  );
});

test('cluster-check fails disabled fencing, an unfenceable node, lost quorum and a missing copy', async () => {
  const broken = {
    ...healthy,
    'corosync-quorumtool -s': 'Quorate:          No\n',
    'crm_attribute stonith-enabled': 'false\n',
    'crm_attribute no-quorum-policy': 'ignore\n',
    'stonith_admin --list node-b': '0 fence devices found\n',
    'drbdsetup show arkvory': 'resource arkvory {\n}\n',
    'drbdsetup status --json arkvory': drbdStatus('Inconsistent'),
    'crm_resource --resource arkvory --locate': '',
  };
  const failed = (await clusterChecks(toolOf(broken), 'arkvory'))
    .filter((result) => !result.ok)
    .map((result) => result.name);
  assert.deepEqual(failed, [
    'quorum',
    'stonith-enabled',
    'no-quorum-policy',
    'fence node-b',
    'drbd quorum',
    'drbd fencing',
    'complete copies',
    'active node',
  ]);
  // Unset properties are Pacemaker's safe defaults, not failures.
  const {
    ['crm_attribute stonith-enabled']: _s,
    ['crm_attribute no-quorum-policy']: _p,
    ...unset
  } = healthy;
  assert.ok((await clusterChecks(toolOf(unset), 'arkvory')).every((result) => result.ok));
});

test('cluster tool output: node names and where the group runs', () => {
  assert.deepEqual(clusterNodes('1 node-a member\n2 node-b lost\n\n'), ['node-a', 'node-b']);
  assert.deepEqual(locatedOn('resource arkvory is running on: node-b\n'), ['node-b']);
  assert.deepEqual(locatedOn('resource arkvory is NOT running\n'), []);
});

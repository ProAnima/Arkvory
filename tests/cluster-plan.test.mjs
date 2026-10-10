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
    'hosts node-a node-b witness;',
    'address 10.0.0.3:7789;\n    disk none;',
  ])
    assert.ok(resource.includes(line), line);
  const pacemaker = pacemakerCommands(input);
  assert.ok(pacemaker.includes('stonith-enabled=true'));
  assert.ok(pacemaker.includes('host=10.0.0.3 algorithm=ffsplit'));
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
  assert.equal(pacemaker.match(/pcs stonith create/g)?.length, 3);
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

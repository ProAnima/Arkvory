import test from 'node:test';
import assert from 'node:assert/strict';
import { fencingFailureEvidence } from './deployment/ha-fencing-evidence.mjs';

const blocked = `Node node-a (1): UNCLEAN (offline)
  * arkvory-drbd (ocf:linbit:drbd): Unpromoted node-b
Failed Resource Actions:
  * fence-node-a_start_0 on node-b 'error' (1): call=55, status='Timed Out', exitreason='Fence agent did not complete within 20s'
Fencing History:
  * reboot of node-a pending: client=pacemaker-controld.1145, origin=node-b
  * reboot of node-b successful: delegate=node-a, origin=node-a`;

test('HA evidence accepts a failed fence action or the exact blocked fence-start path', () => {
  assert.equal(
    fencingFailureEvidence('Failed Fencing Actions:\n reboot of node-a failed', 'node-a', 'node-b'),
    true,
  );
  assert.equal(fencingFailureEvidence(blocked, 'node-a', 'node-b'), true);
  assert.equal(
    fencingFailureEvidence(blocked.replaceAll('node-a', 'node-c'), 'node-c', 'node-b'),
    true,
  );
});

test('HA evidence never treats another resource failure or a pending fence alone as proof', () => {
  for (const text of [
    blocked.replace('fence-node-a_start_0', 'fence-node-b_start_0'),
    blocked.replace('fence-node-a_start_0', 'arkvory-api_start_0'),
    blocked.replace('origin=node-b', 'origin=node-a'),
    blocked.replace('UNCLEAN', 'online'),
    blocked.replace('Unpromoted node-b', 'Promoted node-b'),
    blocked.replace("status='Timed Out'", "status='complete'"),
    blocked.replace('reboot of node-a pending', 'reboot of node-b successful'),
    'reboot of node-a pending: origin=node-b',
  ])
    assert.equal(fencingFailureEvidence(text, 'node-a', 'node-b'), false);
  assert.throws(() => fencingFailureEvidence(blocked, '.*', 'node-b'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { failoverPhases, journalLines } from './deployment/ha-failover.mjs';

// A timeline modelled on the failover that took 79 s (CI, 2026-10-15), in `journalctl -o
// short-unix` form. The power-off was at 1000.0 s.
const journal = [
  '990.000000 node-a pacemaker-controld[4582]:  notice: Result of start operation for arkvory-api on node-a: ok',
  '1007.100000 node-a pacemaker-fenced[4579]:  notice: Node node-b state is now lost',
  '1010.900000 node-a kernel: drbd arkvory node-b: conn( Connected -> NetworkFailure ) peer( Primary -> Unknown )',
  "1011.200000 node-a pacemaker-fenced[4579]:  notice: Operation 'reboot' targeting node-b by node-a for pacemaker-controld.4582@node-a: OK (complete)",
  '1040.800000 node-a pacemaker-controld[4582]:  notice: Initiating promote operation arkvory-drbd_promote_0 locally on node-a',
  '1061.300000 node-a pacemaker-controld[4582]:  notice: Result of promote operation for arkvory-drbd on node-a: ok',
  '1071.100000 node-a pacemaker-controld[4582]:  notice: Result of start operation for arkvory-api on node-a: ok',
  '1078.500000 node-a pacemaker-controld[4582]:  notice: Result of start operation for arkvory-ip on node-a: ok',
  'not a journal line',
].join('\n');

test('failover phases count from the power-off and ignore what came before it', () => {
  const lines = journalLines(journal);
  assert.equal(lines.length, 8);
  assert.deepEqual(failoverPhases(lines, 1000000), {
    membershipLost: 7.1,
    drbdLostPeer: 10.9,
    fenced: 11.2,
    promotionStarted: 40.8,
    promoted: 61.3,
    apiStarted: 71.1,
    addressUp: 78.5,
  });
});

test('a phase missing from the journal is left out, not reported as zero', () => {
  const lines = journalLines(journal).filter((line) => !line.text.includes('promote'));
  const phases = failoverPhases(lines, 1000000);
  assert.equal(phases.promoted, undefined);
  assert.equal(phases.promotionStarted, undefined);
  assert.equal(phases.addressUp, 78.5);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ownMount, releaseVolume } from '../apps/deploy/dist/cluster-volume.js';

const root = '/opt/proanima-arkvory';

/** A host whose tools answer from `outputs`; what it ran is recorded. */
function host(outputs) {
  const ran = [];
  const answer = (executable, args) => {
    const key = [executable, ...args].join(' ');
    if (!(key in outputs)) throw new Error(`${key} failed`);
    return outputs[key];
  };
  return {
    ran,
    run: async (executable, args) => {
      ran.push([executable, ...args].join(' '));
      answer(executable, args);
    },
    output: async (executable, args) => answer(executable, args),
  };
}
const units = 'arkvory-api.service enabled\narkvory-update.timer enabled\n';
const standalone = {
  'drbdadm sh-dev arkvory': '/dev/drbd0\n',
  [`findmnt -n -o TARGET --mountpoint ${root}`]: `${root}\n`,
  [`findmnt -n -o SOURCE --mountpoint ${root}`]: '/dev/sdb1\n',
  'systemctl list-unit-files --no-legend --plain arkvory-*': units,
  'systemctl stop arkvory-api': '',
  'systemctl stop arkvory-update.timer': '',
  [`umount ${root}`]: '',
  'drbdadm secondary arkvory': '',
};

test('a root mounted from a plain data disk is never released: nothing stops, nothing unmounts', async () => {
  const disk = host(standalone);
  await assert.rejects(releaseVolume(root, 'arkvory', { host: disk }), /\/dev\/sdb1/);
  assert.deepEqual(
    disk.ran.filter((line) => !line.startsWith('systemctl is-active')),
    [],
  );
  // No DRBD resource at all: refused just the same.
  const plain = { ...standalone };
  delete plain['drbdadm sh-dev arkvory'];
  await assert.rejects(ownMount(root, 'arkvory', host(plain)), /drbdadm sh-dev arkvory failed/);
});

test('the volume mounted from its DRBD device is released in stop order, under the lock', async () => {
  const volume = host({
    ...standalone,
    [`findmnt -n -o SOURCE --mountpoint ${root}`]: '/dev/drbd0\n',
  });
  // The units stop under the installation lock; the unmount waits until it is released.
  const guard = async (work) => {
    volume.ran.push('lock');
    await work();
    volume.ran.push('unlock');
  };
  await releaseVolume(root, 'arkvory', { host: volume, guard });
  assert.deepEqual(
    volume.ran.filter((line) => !line.startsWith('systemctl is-active')),
    [
      'lock',
      'systemctl stop arkvory-update.timer',
      'systemctl stop arkvory-api',
      'unlock',
      `umount ${root}`,
      'drbdadm secondary arkvory',
    ],
  );
});

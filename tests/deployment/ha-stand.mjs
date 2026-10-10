import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireDisposableHost } from './disposable-host.mjs';
import { baseImage, fencingAccount, keys, removeGuests } from './ha-vms.mjs';
import { buildCluster, diagnostics, ROOT } from './ha-cluster.mjs';
import { client } from './ha-load.mjs';
import {
  active,
  activeFailure,
  fencingFailure,
  fullResync,
  partition,
  secondLoss,
  singleCopy,
  standbyFailure,
  updateAndSwitchover,
} from './ha-scenarios.mjs';

/*
 * Gates deployment-ha* (ADR 0072): an HA cluster of KVM guests built from the native .deb, with
 * real DRBD 9, Pacemaker, quorum and fence_virsh, through the failure scenarios of the ADR.
 * Usage: ha-stand.mjs <suite>; the suites split the scenarios so each gate fits its time limit
 * and the CI jobs run in parallel. ARKVORY_KEEP_STAND keeps the guests of a failed run.
 */
if (process.platform !== 'linux') throw new Error('The HA stand needs a Linux host with KVM');
requireDisposableHost('The HA stand');
if (!existsSync('/dev/kvm')) throw new Error('The HA stand needs KVM (/dev/kvm)');
const candidate = resolve(process.env.ARKVORY_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
const artifact = join(candidate, 'Arkvory-amd64.deb');
const suite = process.argv[2] ?? '';

/** The same code packaged as the next minor version: the release an update in the cluster applies. */
async function nextRelease(work) {
  const { version } = JSON.parse(await readFile(join(candidate, 'native-linux.json'), 'utf8'));
  const [major, minor] = version.split('.').map(Number);
  const next = `${String(major)}.${String(minor + 1)}.0`;
  assert.ok(process.env.npm_execpath, 'Run through npm run gate');
  const base = join(work, 'base');
  const output = join(work, 'native');
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'release:package', '--', next, base],
    {
      stdio: 'inherit',
    },
  );
  execFileSync(process.execPath, ['scripts/package-native.mjs', base, output], {
    stdio: 'inherit',
  });
  return { version: next, path: join(output, 'Arkvory-amd64.deb') };
}

const suites = {
  failures: {
    profile: 'ha-2',
    scenarios: [standbyFailure, singleCopy, activeFailure, partition, fencingFailure],
  },
  operations: {
    profile: 'ha-2',
    scenarios: [
      activeFailure,
      updateAndSwitchover,
      fullResync,
      { name: 'the active node fails again, now on the other side', run: reverseFailure },
    ],
  },
  'three-nodes': { profile: 'ha-3', scenarios: [standbyFailure, secondLoss, activeFailure] },
};
const selected = suites[suite];
if (!selected)
  throw new Error(`Unknown HA stand suite "${suite}": ${Object.keys(suites).join(', ')}`);

/** Scenario 1 in the other direction: the node that took over loses power this time. */
async function reverseFailure(context) {
  const first = context.timings.activeLosses?.[0]?.node;
  const current = await active(context.cluster);
  if (current.name === first) {
    const [other] = context.cluster.data.filter((node) => node !== current);
    await current.shell.exec(`arkvory cluster-switchover --root ${ROOT} --to ${other.name}`);
  }
  const result = await activeFailure.run(context);
  assert.notEqual(context.timings.activeLosses.at(-1).node, first);
  return result;
}

async function runSuite({ profile, scenarios }, base, identity, next) {
  let cluster;
  let passed = false;
  try {
    console.log(`HA stand ${profile}: building the cluster`);
    cluster = await buildCluster({ profile, base, keys: identity, artifact });
    const api = client({ host: '192.168.122.100', ca: cluster.tls.ca, token: cluster.token });
    const context = { cluster, api, next, timings: {} };
    for (const scenario of scenarios) {
      const started = Date.now();
      console.log(`HA stand ${profile}: ${scenario.name}`);
      const result = await scenario.run(context);
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(
        `HA stand ${profile}: passed in ${String(seconds)} s ${JSON.stringify(result ?? {})}`,
      );
    }
    console.log(`HA stand ${profile}: ${JSON.stringify(context.timings)}`);
    passed = true;
  } catch (error) {
    await diagnostics(cluster);
    throw error;
  } finally {
    if (passed || !process.env.ARKVORY_KEEP_STAND) await removeGuests();
  }
}

const work = await mkdtemp(join(tmpdir(), 'arkvory-ha-'));
try {
  await removeGuests();
  const identity = await keys();
  await fencingAccount(identity.fencePublic);
  const base = await baseImage();
  const next = suite === 'operations' ? await nextRelease(work) : null;
  await runSuite(selected, base, identity, next);
  console.log(`HA stand ${suite}: every scenario passed`);
} finally {
  await rm(work, { recursive: true, force: true });
}

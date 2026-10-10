import assert from 'node:assert/strict';
import { power, setFencing } from './ha-vms.mjs';
import { activeNodes, ROOT, until, volumeOn } from './ha-cluster.mjs';
import { bigItem, writer } from './ha-load.mjs';

/*
 * The failure scenarios of ADR 0072 ("Проверка"). Each starts and ends with a healthy cluster:
 * every data node in Pacemaker, both (or all three) copies complete, Arkvory on one node.
 */

const BIG = Number(process.env.ARKVORY_HA_BIG_BYTES ?? 5 * 1024 ** 3);

/** A few acknowledged uploads before a failure: the scenario then has something to lose. */
const acknowledgedSome = (load) =>
  until(
    () => load.items.filter((item) => item.acknowledged).length >= 3,
    'acknowledged uploads before the failure',
    120000,
    500,
  ).catch((error) => {
    const last = load.items.slice(-4).map((item) => item.last);
    throw new Error(`${error.message}; last answers ${JSON.stringify(last)}`);
  });

export async function active(cluster) {
  const names = await activeNodes(cluster);
  assert.equal(names.length, 1, `exactly one active node (${names.join(', ')})`);
  return cluster.node(names[0]);
}

const standbys = async (cluster) => {
  const current = await active(cluster);
  return cluster.data.filter((node) => node !== current);
};

const bootId = (node) => node.shell.exec('cat /proc/sys/kernel/random/boot_id');

/** Progress in the gate log: a stand that waits shows what it waits for. */
const step = (text) => {
  console.log(`  ${new Date().toISOString()} ${text}`);
};

/** Loses a node as a power failure would and remembers its boot to see the fence restart it. */
async function powerOff(node) {
  step(`power off ${node.name}`);
  node.lostBoot = await bootId(node);
  await power.off(node.domain);
}

/** Back after a failure: fencing has restarted it; the operator rejoins it to the cluster. */
async function rejoin(cluster, node) {
  await until(
    async () => {
      if ((await power.state(node.domain)).includes('shut off')) await power.on(node.domain);
      return (await bootId(node)) !== node.lostBoot;
    },
    `${node.name} to boot again`,
    600000,
    5000,
  );
  step(`${node.name} restarted; starting the cluster there`);
  await node.shell.exec('pcs cluster start --wait=180');
}

async function complete(cluster) {
  const expected = cluster.data.length;
  step(`waiting for ${String(expected)} complete copies`);
  await until(
    async () => (await volumeOn(await active(cluster))).copies === expected,
    `${String(expected)} complete copies`,
    900000,
    5000,
  );
}

async function writes(api, expected) {
  step(`waiting for writes to answer ${String(expected)}`);
  let last;
  await until(
    async () => {
      last = await api.canWrite();
      return expected === 201
        ? last.status === 201
        : last.status === 503 && last.reason === 'replication_degraded';
    },
    `writes to answer ${String(expected)}`,
    600000,
  ).catch((error) => {
    throw new Error(`${error.message}; last answer ${JSON.stringify(last)}`);
  });
}

/** Runs `work` over the items, a few at a time. */
async function inParallel(items, work, width = 8) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await work(item);
    }),
  );
}

/** Every acknowledged upload reads back intact; the others are confirmed by a retry now. */
async function settle(api, items) {
  const acknowledged = items.filter((entry) => entry.acknowledged);
  const retried = items.filter((entry) => !entry.acknowledged);
  step(`reading back ${String(acknowledged.length)} acknowledged uploads`);
  await inParallel(acknowledged, async (item) => {
    const read = await api.read(item);
    assert.deepEqual(
      read,
      { status: 200, sha256: item.sha256 },
      `acknowledged ${item.name} survived`,
    );
  });
  step(`confirming ${String(retried.length)} unacknowledged uploads by retry`);
  await inParallel(
    retried,
    async (item) => {
      await until(
        async () => (await api.upload(item)).acknowledged,
        `a retry to confirm ${item.name}`,
        900000,
        3000,
      );
      assert.equal((await api.read(item)).sha256, item.sha256);
    },
    4,
  );
  return { acknowledged: acknowledged.length, retried: retried.length };
}

async function readRecovery(api, since) {
  await until(
    async () => (await api.ready()).status === 200,
    'reads through the virtual address',
    600000,
    1000,
  );
  return Math.round((Date.now() - since) / 1000);
}

export const standbyFailure = {
  name: 'standby lost during writes: refused writes, working reads, automatic return',
  async run({ cluster, api }) {
    const load = writer(api, 'standby-loss');
    await acknowledgedSome(load);
    const [standby] = await standbys(cluster);
    await powerOff(standby);
    if (cluster.profile === 'ha-2') {
      await writes(api, 503);
      const done = load.items.filter((item) => item.acknowledged);
      assert.ok(done.length > 0);
      assert.equal((await api.read(done[0])).status, 200, 'reads continue');
    } else {
      // ha-3: two copies remain, writes go on through the loss.
      await new Promise((resolve) => setTimeout(resolve, 20000));
      await writes(api, 201);
    }
    await rejoin(cluster, standby);
    await complete(cluster);
    await writes(api, 201);
    return settle(api, await load.stop());
  },
};

/**
 * Every data node back in the cluster, as an operator restores a cluster that lost its quorum:
 * powered on, Pacemaker started where it is not running. A node that Pacemaker fences on the
 * way back (one that could not stop cleanly without quorum) is started again after its restart.
 */
async function restoreAll(cluster, api) {
  await until(
    async () => {
      for (const node of cluster.data) {
        if ((await power.state(node.domain)).includes('shut off')) await power.on(node.domain);
        const running = await node.shell.tryExec('systemctl is-active --quiet pacemaker');
        if (!running.ok) await node.shell.tryExec('pcs cluster start --wait=120');
      }
      // A node without quorum keeps reporting the group it failed to stop: judge by quorum,
      // Pacemaker on every node and Arkvory answering through the virtual address.
      for (const node of cluster.data)
        if (!(await node.shell.tryExec('systemctl is-active --quiet pacemaker')).ok) return false;
      const quorum = await cluster.data[0].shell.tryExec('corosync-quorumtool -s');
      return /Quorate:\s+Yes/.test(quorum.output) && (await api.ready()).status === 200;
    },
    'every node back and Arkvory running',
    900000,
    10000,
  );
}

/**
 * ha-3 loses two of three nodes: the last one has neither Corosync nor DRBD quorum, so Arkvory
 * stops rather than risk a writer without quorum. Restoring the nodes brings it back with every
 * acknowledged upload.
 */
export const secondLoss = {
  name: 'ha-3: two lost nodes stop the service; restored nodes keep every acknowledged upload',
  async run({ cluster, api }) {
    const load = writer(api, 'double-loss');
    await acknowledgedSome(load);
    const lost = await standbys(cluster);
    for (const node of lost) await powerOff(node);
    await until(
      async () => (await api.ready()).status !== 200,
      'Arkvory to stop without quorum',
      300000,
    );
    const items = await load.stop();
    await restoreAll(cluster, api);
    await complete(cluster);
    await writes(api, 201);
    return settle(api, items);
  },
};

export const singleCopy = {
  name: 'operator accepts a single copy; the decision ends when the copy is back',
  async run({ cluster, api }) {
    const [standby] = await standbys(cluster);
    await powerOff(standby);
    await writes(api, 503);
    const primary = await active(cluster);
    const deadline = new Date(Date.now() + 3600000).toISOString();
    await primary.shell.exec(
      `arkvory cluster-single-copy --root ${ROOT} --until ${deadline} --reason 'ha stand: peer disk replaced'`,
    );
    await writes(api, 201);
    const ready = await api.ready();
    assert.equal(ready.json.replication.required, 1);
    assert.ok(ready.json.replication.singleCopyUntil);
    assert.match((await api.metrics()).text, /arkvory_replication_required_copies(\{[^}]*\})? 1\b/);
    await rejoin(cluster, standby);
    await complete(cluster);
    // The replica service ends the decision on its next reading of complete copies.
    await until(
      async () => {
        await api.ready();
        return (await primary.shell.tryExec(`test ! -e ${ROOT}/config/single-copy.json`)).ok;
      },
      'the single-copy decision to end',
      60000,
    );
    // The reading that ended the decision was answered with it; readiness keeps a 1 s snapshot.
    await until(
      async () => (await api.ready()).json?.replication?.required === 2,
      'writes to need two copies again',
      30000,
      1000,
    );
  },
};

/** Power loss of the active node during a large upload and a stream of small ones. */
export const activeFailure = {
  name: 'active node loses power during a large upload',
  async run(context) {
    const { cluster, api, timings } = context;
    const load = writer(api, `active-loss-${String(timings.activeLosses?.length ?? 0)}`);
    const big = bigItem(`large-${String(Date.now())}`, BIG);
    let half;
    const halfway = new Promise((resolve) => (half = resolve));
    const sending = api.upload(big, (sent) => {
      if (sent >= BIG / 2) half();
    });
    // The upload may end before halfway (refused or failed): never wait for a half that is not coming.
    await Promise.race([
      halfway,
      sending.then((item) => {
        throw new Error(`The large upload ended early: ${JSON.stringify(item.last)}`);
      }),
    ]);
    step('the large upload is halfway');
    const lost = await active(cluster);
    const since = Date.now();
    await powerOff(lost);
    const seconds = await readRecovery(api, since);
    (timings.activeLosses ??= []).push({ node: lost.name, readRecoverySeconds: seconds });
    await sending;
    if (cluster.profile === 'ha-2') await writes(api, 503);
    else await writes(api, 201);
    await rejoin(cluster, lost);
    await complete(cluster);
    await writes(api, 201);
    return settle(api, [...(await load.stop()), big]);
  },
};

export const partition = {
  name: 'network partition between data nodes: one active, the other fenced',
  async run({ cluster, api }) {
    const load = writer(api, 'partition');
    const primary = await active(cluster);
    const [other] = await standbys(cluster);
    const boots = { [primary.name]: await bootId(primary), [other.name]: await bootId(other) };
    await other.shell.exec(
      `iptables -I INPUT -s ${primary.address} -j DROP && iptables -I OUTPUT -d ${primary.address} -j DROP`,
    );
    let loser;
    await until(
      async () => {
        for (const node of [primary, other]) {
          const boot = await node.shell.tryExec('cat /proc/sys/kernel/random/boot_id');
          if (boot.ok && boot.output !== boots[node.name]) loser = node;
        }
        return loser !== undefined;
      },
      'fencing to restart the losing side',
      300000,
      3000,
    );
    const winner = loser === primary ? other : primary;
    await until(
      async () => (await activeNodes(cluster)).join() === winner.name,
      `Arkvory on ${winner.name} only`,
      300000,
    );
    loser.lostBoot = boots[loser.name];
    await rejoin(cluster, loser);
    await complete(cluster);
    for (const node of [primary, other])
      assert.doesNotMatch(
        await node.shell.exec('drbdadm cstate arkvory'),
        /StandAlone/,
        'no split brain',
      );
    await writes(api, 201);
    return { loser: loser.name, ...(await settle(api, await load.stop())) };
  },
};

export const fencingFailure = {
  name: 'fencing fails: no failover until fencing works again',
  async run({ cluster, api }) {
    const lost = await active(cluster);
    const [survivor] = await standbys(cluster);
    await setFencing(false);
    try {
      await powerOff(lost);
      // Long enough for Pacemaker to have failed over had it not required fencing.
      await new Promise((resolve) => setTimeout(resolve, 90000));
      // Until the lost node is fenced, Pacemaker still counts the group as running there.
      assert.ok(
        !(await activeNodes(cluster)).includes(survivor.name),
        'no failover while the lost node is not fenced',
      );
      assert.equal((await api.ready()).status, 0);
      assert.match(
        await survivor.shell.exec('pcs status --full'),
        /Failed Fencing Actions|fencing.*failed/i,
      );
    } finally {
      await setFencing(true);
    }
    // The operator repaired fencing and clears its history: Pacemaker fences and fails over.
    await survivor.shell.exec(`pcs stonith history cleanup ${lost.name} && pcs resource cleanup`);
    await until(
      async () => (await activeNodes(cluster)).join() === survivor.name,
      `failover to ${survivor.name}`,
      600000,
    );
    await rejoin(cluster, lost);
    await complete(cluster);
    await writes(api, 201);
  },
};

export const updateAndSwitchover = {
  name: 'release update in the cluster, then a planned switchover',
  async run({ cluster, api, next }) {
    const before = writer(api, 'before-update');
    await acknowledgedSome(before);
    const kept = await before.stop();
    const primary = await active(cluster);
    for (const node of cluster.data) await node.shell.copy(next.path, '/stand/next.deb');
    // Standby nodes only take the package files: the release lives on the volume.
    for (const node of await standbys(cluster)) await node.shell.exec('dpkg -i /stand/next.deb');
    await primary.shell.exec('dpkg -i /stand/next.deb');
    const installation = JSON.parse(await primary.shell.exec(`cat ${ROOT}/installation.json`));
    assert.equal(installation.current.version, next.version);
    const managed = await primary.shell.tryExec(
      'crm_resource --resource arkvory --meta --get-parameter is-managed',
    );
    assert.ok(!managed.ok || !managed.output.includes('false'), 'Pacemaker manages Arkvory again');
    const [target] = await standbys(cluster);
    await primary.shell.exec(`arkvory cluster-switchover --root ${ROOT} --to ${target.name}`);
    assert.equal((await active(cluster)).name, target.name);
    await writes(api, 201);
    await settle(api, kept);
  },
};

export const fullResync = {
  name: 'full resynchronization of a node under read load',
  async run({ cluster, api }) {
    const load = writer(api, 'resync-source');
    await acknowledgedSome(load);
    const items = (await load.stop()).filter((item) => item.acknowledged);
    const [standby] = await standbys(cluster);
    await standby.shell.exec('drbdadm invalidate arkvory');
    // The whole device is copied again (minutes), so the drop to one copy is observable.
    await until(
      async () => (await volumeOn(await active(cluster))).copies < cluster.data.length,
      'the full resynchronization to start',
      60000,
      500,
    );
    let reads = 0;
    let resynchronizing = true;
    const reading = (async () => {
      while (resynchronizing)
        for (const item of items) {
          assert.deepEqual(await api.read(item), { status: 200, sha256: item.sha256 });
          reads++;
        }
    })();
    try {
      await complete(cluster);
    } finally {
      resynchronizing = false;
    }
    await reading;
    assert.ok(reads > 0);
    await writes(api, 201);
    return { reads };
  },
};

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { volumeState } from '../../apps/deploy/dist/replica-state.js';
import { locatedOn } from '../../apps/deploy/dist/cluster-ops.js';
import { createGuest, HOST_ADDRESS, run, ssh } from './ha-vms.mjs';

/*
 * Builds an HA cluster the way the operator documentation does (ADR 0072): the plan from
 * `arkvory cluster-plan`, the DRBD volume, the package on the first node, `configure
 * --cluster`, `cluster-node` on every other data node, then Pacemaker from the plan with the
 * site's fence agent parameters filled in.
 */
export const ROOT = '/opt/proanima-arkvory';
export const VIP = '192.168.122.100';
const STOP_ALL =
  'systemctl stop arkvory-update.timer arkvory-backup arkvory-worker arkvory-api arkvory-replica arkvory-database';

export function layout(profile) {
  const names = profile === 'ha-2' ? ['node-a', 'node-b'] : ['node-a', 'node-b', 'node-c'];
  const data = names.map((name, index) => ({
    name,
    address: `192.168.122.${String(11 + index)}`,
    dataGiB: 16,
    memoryMiB: 2560,
  }));
  const witness =
    profile === 'ha-2' ? { name: 'witness', address: '192.168.122.13', memoryMiB: 1024 } : null;
  return { profile, data, witness, all: [...data, ...(witness ? [witness] : [])] };
}

export async function until(condition, what, timeoutMs = 180000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await condition()) return;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Complete copies and the role as the node's own kernel reports them. */
export async function volumeOn(node) {
  return volumeState(
    JSON.parse(await node.shell.exec('drbdsetup status --json arkvory')),
    'arkvory',
  );
}

export async function activeNodes(cluster) {
  for (const node of cluster.data) {
    const answer = await node.shell.tryExec('crm_resource --resource arkvory --locate');
    if (answer.ok) return locatedOn(answer.output);
  }
  return [];
}

async function tls(work) {
  const at = (name) => join(work, name);
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];
  await run('openssl', [
    'req',
    '-x509',
    ...ec,
    '-days',
    '2',
    '-subj',
    '/CN=arkvory-ha-ca',
    '-keyout',
    at('ca.key'),
    '-out',
    at('ca.crt'),
  ]);
  await run('openssl', [
    'req',
    ...ec,
    '-subj',
    '/CN=arkvory',
    '-keyout',
    at('tls.key'),
    '-out',
    at('tls.csr'),
  ]);
  await writeFile(at('ext'), `subjectAltName=IP:${VIP}\nextendedKeyUsage=serverAuth\n`);
  await run('openssl', [
    'x509',
    '-req',
    '-in',
    at('tls.csr'),
    '-CA',
    at('ca.crt'),
    '-CAkey',
    at('ca.key'),
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    at('ext'),
    '-out',
    at('tls.crt'),
  ]);
  return { ca: await readFile(at('ca.crt'), 'utf8'), cert: at('tls.crt'), key: at('tls.key') };
}

/** The package files on every data node, unconfigured: nothing is installed before the volume. */
async function unpack(cluster, artifact) {
  for (const node of cluster.data) {
    await node.shell.exec('mkdir -p /stand');
    await node.shell.copy(artifact, '/stand/Arkvory-amd64.deb');
    await node.shell.exec('dpkg --unpack /stand/Arkvory-amd64.deb');
  }
}

/** `arkvory cluster-plan` on the first node, with the site's fence parameters filled in. */
async function plan(cluster, work) {
  const { data, witness } = cluster;
  const [first] = data;
  const options = [
    '--cluster',
    cluster.profile,
    '--nodes',
    data.map((node) => `${node.name}=${node.address}`).join(','),
    ...(witness ? ['--witness', `${witness.name}=${witness.address}`] : []),
    '--disk',
    '/dev/vdb',
    '--fence-agent',
    'fence_virsh',
    '--virtual-ip',
    `${VIP}/24`,
    '--output',
    '/root/plan',
  ];
  await first.shell.exec(`arkvory cluster-plan ${options.join(' ')}`);
  await first.shell.fetch('/root/plan/arkvory.res', join(work, 'arkvory.res'));
  await first.shell.fetch('/root/plan/pacemaker.sh', join(work, 'pacemaker.sh'));
  const pacemaker = (await readFile(join(work, 'pacemaker.sh'), 'utf8')).replace(
    /(stonith create fence-(\S+) fence_virsh pcmk_host_list=\S+) <[^>]*>/g,
    (_, command, node) =>
      `${command} ip=${HOST_ADDRESS} username=arkvoryfence identity_file=/root/.ssh/fence_key plug=arkvory-ha-${node}`,
  );
  const commands = pacemaker.split('\n').filter((line) => !line.startsWith('#'));
  assert.ok(
    commands.every((line) => !/<[^>]*>/.test(line)),
    'every placeholder of the plan is filled',
  );
  return { resource: join(work, 'arkvory.res'), pacemaker };
}

/** The DRBD volume on every node; the first data node formats it and keeps it primary. */
async function volume(cluster, resourceFile) {
  for (const node of cluster.all) await node.shell.copy(resourceFile, '/etc/drbd.d/arkvory.res');
  for (const node of cluster.data) await node.shell.exec('drbdadm -- --force create-md arkvory');
  await Promise.all(cluster.all.map((node) => node.shell.exec('drbdadm up arkvory')));
  // The witness keeps its diskless tiebreaker across reboots; data nodes get DRBD from Pacemaker.
  if (cluster.witness) await cluster.witness.shell.exec('systemctl enable drbd@arkvory.service');
  const [first] = cluster.data;
  await until(
    async () =>
      (await first.shell.exec('drbdadm cstate arkvory'))
        .split('\n')
        .filter((line) => line.trim() === 'Connected').length ===
      cluster.all.length - 1,
    'every DRBD connection',
  );
  // Fresh disks hold nothing to synchronize: skip the initial full resynchronization.
  await first.shell.exec('drbdadm new-current-uuid --clear-bitmap arkvory/0');
  await until(
    async () => (await volumeOn(first)).copies === cluster.data.length,
    'all copies UpToDate',
  );
  await first.shell.exec(
    `drbdadm primary arkvory && mkfs.xfs -q /dev/drbd0 && mkdir -p ${ROOT} && mount /dev/drbd0 ${ROOT}`,
  );
}

async function installFirst(cluster, certificates) {
  const [first] = cluster.data;
  await first.shell.copy(certificates.cert, '/stand/tls.crt');
  await first.shell.copy(certificates.key, '/stand/tls.key');
  // The unpacked package installs into the mounted volume.
  await first.shell.exec('dpkg --configure proanima-arkvory');
  // TLS material on the volume: every node that becomes active finds it at the same path.
  await first.shell.exec(
    `install -d -m 0750 -o root -g arkvory ${ROOT}/config/tls && install -m 0644 /stand/tls.crt ${ROOT}/config/tls/tls.crt && install -m 0640 -g arkvory /stand/tls.key ${ROOT}/config/tls/tls.key`,
  );
  await first.shell.exec(
    `arkvory configure --root ${ROOT} --tls-cert ${ROOT}/config/tls/tls.crt --tls-key ${ROOT}/config/tls/tls.key --listen-host 0.0.0.0`,
  );
  await first.shell.exec(`arkvory configure --root ${ROOT} --cluster ${cluster.profile}`);
  cluster.token = (await first.shell.exec(`cat ${ROOT}/config/bootstrap-token.txt`)).trim();
  await first.shell.exec(`${STOP_ALL} && umount ${ROOT} && drbdadm secondary arkvory`);
}

/** Each other data node gets the package while the volume is mounted there once. */
async function joinOthers(cluster) {
  for (const node of cluster.data.slice(1)) {
    await node.shell.exec(
      `drbdadm primary arkvory && mkdir -p ${ROOT} && mount /dev/drbd0 ${ROOT}`,
    );
    await node.shell.exec(
      `arkvory cluster-node --root ${ROOT} --cluster-resource arkvory && dpkg --configure proanima-arkvory`,
    );
    await node.shell.exec(`${STOP_ALL} && umount ${ROOT} && drbdadm secondary arkvory`);
  }
}

async function pacemaker(cluster, keys, script) {
  const password = randomBytes(18).toString('base64url');
  for (const node of cluster.all) {
    await node.shell.exec('chpasswd', { input: `hacluster:${password}\n` });
    await node.shell.exec('systemctl enable --now pcsd');
  }
  for (const node of cluster.data) {
    await node.shell.exec(
      `install -d -m 0700 /root/.ssh && cat > /root/.ssh/fence_key && chmod 0600 /root/.ssh/fence_key && ssh-keyscan -H ${HOST_ADDRESS} >> /root/.ssh/known_hosts`,
      { input: keys.fence },
    );
    // Debian and Ubuntu packages ship a sample corosync.conf, which pcs takes for a cluster.
    await node.shell.exec('pcs cluster destroy');
  }
  const [first] = cluster.data;
  await first.shell.exec(
    `pcs host auth ${cluster.all.map((node) => node.name).join(' ')} -u hacluster -p ${password}`,
  );
  await first.shell.exec(
    `pcs cluster setup arkvory ${cluster.data.map((node) => `${node.name} addr=${node.address}`).join(' ')} --start --wait=180`,
  );
  if (cluster.witness)
    await cluster.witness.shell.exec(
      // The Debian and Ubuntu package has initialized the device for its own service account;
      // `pcs qdevice setup` would recreate it owned by root, which the service cannot read.
      'systemctl enable --now corosync-qnetd',
    );
  await first.shell.exec('cat > /root/pacemaker.sh', { input: script });
  await first.shell.exec('cd /root && sh -x pacemaker.sh');
  await until(
    async () => (await activeNodes(cluster)).length === 1,
    'Arkvory to start under Pacemaker',
    300000,
  );
}

/** The whole cluster, ready: the API answers through the virtual address. */
export async function buildCluster({ profile, base, keys, artifact }) {
  const cluster = layout(profile);
  const hosts = cluster.all.map((node) => `${node.address} ${node.name}`);
  for (const node of cluster.all) {
    node.domain = await createGuest(base, { ...node, hosts }, keys.controlPublic);
    node.shell = ssh(keys.control, node.address);
  }
  await Promise.all(
    cluster.all.map((node) =>
      until(
        async () => (await node.shell.tryExec('cloud-init status --wait')).ok,
        `${node.name} to boot`,
        600000,
        5000,
      ),
    ),
  );
  const work = await mkdtemp(join(tmpdir(), 'arkvory-ha-plan-'));
  await unpack(cluster, artifact);
  const files = await plan(cluster, work);
  cluster.tls = await tls(work);
  await volume(cluster, files.resource);
  await installFirst(cluster, cluster.tls);
  await joinOthers(cluster);
  await pacemaker(cluster, keys, files.pacemaker);
  cluster.node = (name) => cluster.all.find((node) => node.name === name);
  // The operator's acceptance check of a new cluster: quorum, fencing, DRBD, both copies.
  const [running] = await activeNodes(cluster);
  console.log(await cluster.node(running).shell.exec(`arkvory cluster-check --root ${ROOT}`));
  return cluster;
}

/** What an operator reads after a failure: Pacemaker, DRBD and the Arkvory journal per node. */
export async function diagnostics(cluster) {
  for (const node of cluster?.all ?? []) {
    if (!node.shell) continue;
    const report = await node.shell.tryExec(
      'pcs status --full; drbdsetup status --verbose; journalctl -n 80 --no-pager -u arkvory-api -u arkvory-replica -u pacemaker -u corosync',
    );
    console.error(`--- ${node.name}\n${report.output}`);
  }
}

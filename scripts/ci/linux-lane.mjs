import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { docker, exec, removeContainer, removeNetwork, waitFor } from './docker.mjs';
import { postgresImage } from './image.mjs';

const work = '/home/runner/work';
const nativeCache = '/home/runner/native-downloads';
const caches = [
  ['arkvory-ci-npm', '/home/runner/.npm'],
  ['arkvory-ci-native', nativeCache],
];

function containerArgs(name, image, { systemd, network }) {
  const args = ['run', '-d', '--name', name, '--label', 'org.proanima.arkvory.ci=local'];
  for (const [volume, path] of caches) args.push('-v', `${volume}:${path}`);
  if (network) args.push('--network', network);
  // Chromium needs a larger /dev/shm than Docker's 64 MiB default.
  args.push('--shm-size', '1g');
  if (!systemd) return [...args, image];
  // A disposable systemd host: services, sudo and package installs stay inside this container.
  // Sibling containers (the RPM check) use the host engine through its socket.
  return [
    ...args,
    '--privileged',
    '--cgroupns=host',
    '--tmpfs',
    '/run',
    '--tmpfs',
    '/run/lock',
    '-v',
    '/sys/fs/cgroup:/sys/fs/cgroup:rw',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    image,
    '/sbin/init',
  ];
}

async function prepare(name, { systemd, signal }) {
  if (systemd) {
    // "degraded" only means an optional unit failed in the container; gates check what they use.
    await waitFor(name, ['sh', '-c', 'systemctl is-system-running --wait; true'], { signal });
    await exec(
      name,
      [
        'sh',
        '-c',
        'gid=$(stat -c %g /var/run/docker.sock) && (getent group "$gid" || groupadd -g "$gid" hostdocker) >/dev/null && usermod -aG "$(getent group "$gid" | cut -d: -f1)" runner',
      ],
      { user: 'root', signal },
    );
  }
  await exec(name, ['chown', '-R', 'runner:runner', '/home/runner'], { user: 'root', signal });
  // Package-install gates resolve dependencies from apt, as the GitHub job does after
  // `apt-get update`; the image ships without lists to stay reproducible and small.
  if (systemd) await exec(name, ['apt-get', 'update', '--quiet'], { user: 'root', signal });
}

async function checkout(root, name, source, signal) {
  const folder = await mkdtemp(join(tmpdir(), 'arkvory-ci-source-'));
  try {
    const bundle = join(folder, 'source.bundle');
    // The bundle carries committed objects only: the container tests exactly `source.commit`.
    execFileSync('git', ['bundle', 'create', bundle, source.ref], { cwd: root, stdio: 'ignore' });
    await docker(['cp', bundle, `${name}:/tmp/source.bundle`], { signal });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  await exec(name, ['chmod', 'a+r', '/tmp/source.bundle'], { user: 'root', signal });
  // Fetch the exact ref: a clone would only map branch refs and miss a working-tree snapshot.
  await exec(name, ['git', 'init', '--quiet', work], { signal });
  await exec(name, ['git', '-C', work, 'fetch', '--quiet', '/tmp/source.bundle', source.ref], {
    signal,
  });
  await exec(name, ['git', '-C', work, 'checkout', '--quiet', '--detach', source.commit], {
    signal,
  });
  // Verified native archives persist across runs in a named volume, as actions/cache does on GitHub.
  await exec(name, ['mkdir', '-p', `${work}/.cache`], { signal });
  await exec(name, ['ln', '-s', nativeCache, `${work}/.cache/native-downloads`], { signal });
  await exec(name, ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    workdir: work,
    signal,
  });
}

async function startDatabase(network, signal) {
  const name = `${network}-postgres`;
  await docker(
    [
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '--label',
      'org.proanima.arkvory.ci=local',
      '--env',
      'POSTGRES_USER=arkvory_test',
      '--env',
      'POSTGRES_PASSWORD=arkvory_test',
      '--env',
      'POSTGRES_DB=arkvory_test',
      '--tmpfs',
      '/var/lib/postgresql',
      postgresImage,
    ],
    { capture: true, signal },
  );
  await waitFor(name, ['pg_isready', '-U', 'arkvory_test', '-d', 'arkvory_test'], { signal });
  return { name, url: `postgresql://arkvory_test:arkvory_test@${name}:5432/arkvory_test` };
}

/**
 * Runs one Linux lane in a fresh container and always copies test-results back, so a failed lane
 * still leaves its gate report as evidence. `inputs` are host directories copied in before the
 * gates (release candidates); `outputs` are container directories copied out afterwards.
 */
export async function runLinuxLane(root, lane, options) {
  const { image, source, results, signal, keep = false, env = {} } = options;
  const id = `arkvory-ci-${lane.name}-${randomBytes(4).toString('hex')}`;
  const systemd = lane.environment === 'linux-systemd-container';
  const network = systemd ? undefined : id;
  let failure;
  try {
    if (network)
      await docker(['network', 'create', '--label', 'org.proanima.arkvory.ci=local', network], {
        capture: true,
        signal,
      });
    const database = network ? await startDatabase(network, signal) : undefined;
    await docker(containerArgs(id, image, { systemd, network }), { capture: true, signal });
    await prepare(id, { systemd, signal });
    await checkout(root, id, source, signal);
    for (const [host, target] of options.inputs ?? []) {
      await docker(['cp', host, `${id}:${target}`], { signal });
      await exec(id, ['chown', '-R', 'runner:runner', target], { user: 'root', signal });
    }
    const variables = { ...env, ...(database ? { ARKVORY_TEST_DATABASE_URL: database.url } : {}) };
    if (systemd) variables.ARKVORY_DISPOSABLE_HOST = 'container';
    await exec(id, ['npm', 'run', 'gate', '--', ...lane.gates], {
      workdir: work,
      env: variables,
      signal,
    });
  } catch (error) {
    failure = error;
  } finally {
    await collect(id, results, options.outputs ?? []);
    if (!keep) {
      await removeContainer(id);
      if (network) {
        await removeContainer(`${network}-postgres`);
        await removeNetwork(network);
      }
    }
  }
  return failure;
}

async function collect(id, results, outputs) {
  await mkdir(results, { recursive: true });
  for (const [source, target] of [[`${work}/test-results/gates`, results], ...outputs])
    try {
      await mkdir(target, { recursive: true });
      await docker(['cp', `${id}:${source}/.`, target], { capture: true, quiet: true });
    } catch {
      // A lane that failed before its first gate has no report; evidence records that failure.
    }
}

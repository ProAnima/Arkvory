import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The base of the local CI image, so the stand runs the distribution the packages target. All
// package dependencies are installed here: the .deb then installs without network access.
const dockerfile = `FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update \\
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus postgresql python3 \\
      ca-certificates libatomic1 iproute2 procps \\
 && rm -rf /var/lib/apt/lists/* \\
 && systemctl mask postgresql.service
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
`;

export function docker(args, { input } = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 ** 2,
    windowsHide: true,
  }).trim();
}

/** The stand image, built once per Dockerfile content and kept like the local CI image. */
export async function standImage() {
  const tag = `arkvory-stand:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 16)}`;
  try {
    docker(['image', 'inspect', tag]);
    return tag;
  } catch {}
  const context = await mkdtemp(join(tmpdir(), 'arkvory-stand-image-'));
  try {
    await writeFile(join(context, 'Dockerfile'), dockerfile);
    docker(['build', '--label', 'org.proanima.arkvory.stand=1', '-t', tag, context]);
  } finally {
    await rm(context, { recursive: true, force: true });
  }
  return tag;
}

/**
 * A network of systemd hosts, each a sibling container of the Docker engine this process uses
 * (in the local CI lane that is the workstation's engine through the mounted socket). Hosts
 * reach each other by name; nothing is published to the workstation.
 */
export function standNetwork() {
  const suffix = randomBytes(4).toString('hex');
  const network = `arkvory-stand-${suffix}`;
  docker(['network', 'create', '--label', 'org.proanima.arkvory.stand=1', network]);
  const hosts = [];
  return {
    network,
    hosts,
    start(name, image) {
      const container = `${network}-${name}`;
      docker([
        'run',
        '-d',
        '--name',
        container,
        '--hostname',
        name,
        '--network',
        network,
        '--network-alias',
        name,
        '--label',
        'org.proanima.arkvory.stand=1',
        '--privileged',
        // systemd needs the host cgroup namespace when the cgroup tree is mounted from the host.
        '--cgroupns=host',
        '--tmpfs',
        '/run',
        '--tmpfs',
        '/run/lock',
        '--tmpfs',
        '/tmp',
        '-v',
        '/sys/fs/cgroup:/sys/fs/cgroup:rw',
        image,
      ]);
      const host = standHost(container, name);
      hosts.push(host);
      return host;
    },
    async remove() {
      for (const host of hosts) {
        try {
          docker(['rm', '-f', host.container]);
        } catch {}
      }
      try {
        docker(['network', 'rm', network]);
      } catch {}
    },
  };
}

function standHost(container, name) {
  const exec = (args, options = {}) =>
    docker(['exec', ...(options.env ?? []).flatMap((e) => ['-e', e]), container, ...args], options);
  return {
    container,
    name,
    exec,
    copy(source, target) {
      docker(['cp', source, `${container}:${target}`]);
    },
    async booted() {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const state = exec(['systemctl', 'is-system-running', '--wait']);
          if (state === 'running' || state === 'degraded') return;
        } catch (error) {
          // `degraded` exits non-zero but the system has booted.
          if (String(error.stdout ?? '').includes('degraded')) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`${name} did not boot systemd`);
    },
    /** One stand-probe command with the installation's Node.js; returns its JSON line. */
    probe(command, args) {
      return JSON.parse(
        exec([
          '/opt/proanima-arkvory/runtime/node',
          '/stand/stand-probe.mjs',
          command,
          JSON.stringify(args),
        ]),
      );
    },
    journal(lines = 80) {
      try {
        return exec([
          'journalctl',
          '-u',
          'arkvory-api',
          '-u',
          'arkvory-worker',
          '-u',
          'arkvory-database',
          '-n',
          String(lines),
          '--no-pager',
        ]);
      } catch (error) {
        return `journal unavailable: ${String(error.message)}`;
      }
    },
  };
}

export async function until(condition, what, seconds = 180) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  for (;;) {
    try {
      last = await condition();
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

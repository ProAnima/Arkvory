import { execFileSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { requireDisposableHost } from './disposable-host.mjs';

export async function exerciseRpm(output) {
  requireDisposableHost('RPM installation');
  const name = `arkvory-rpm-gate-${process.pid}`;
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-rpm-gate-'));
  await writeFile(
    join(directory, 'Dockerfile'),
    'FROM quay.io/fedora/fedora:44\nRUN dnf install -y systemd && dnf clean all\nENV container=docker\nCMD ["/sbin/init"]\n',
  );
  const run = (args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 8 * 1024 ** 2,
    }).trim();
  run(['build', '-t', name, directory]);
  let created = false;
  try {
    run([
      'run',
      '-d',
      '--name',
      name,
      '--privileged',
      // A host cgroup mount must use the matching namespace for systemd's unit hierarchy.
      '--cgroupns=host',
      '--tmpfs',
      '/run',
      '--tmpfs',
      '/tmp',
      '-v',
      '/sys/fs/cgroup:/sys/fs/cgroup:rw',
      name,
    ]);
    created = true;
    // Copy instead of bind-mounting: `docker cp` reads from the client side, so the check also
    // works when the Docker client itself runs in a container (local CI linux-system lane).
    run(['exec', name, 'mkdir', '/candidate']);
    for (const file of ['Arkvory-CLI-x86_64.rpm', 'Arkvory-x86_64.rpm'])
      run(['cp', join(output, file), `${name}:/candidate/${file}`]);
    run(['exec', name, 'dnf', 'install', '-y', '/candidate/Arkvory-CLI-x86_64.rpm']);
    assert.ok(JSON.parse(run(['exec', name, 'arkvoryctl', '--version'])).version);
    assert.throws(() => run(['exec', name, 'rpm', '-q', 'postgresql-server']));
    run(['exec', name, 'dnf', 'reinstall', '-y', '/candidate/Arkvory-CLI-x86_64.rpm']);
    run(['exec', name, 'dnf', 'remove', '-y', 'proanima-arkvory-cli']);
    run(['exec', name, 'dnf', 'install', '-y', '/candidate/Arkvory-x86_64.rpm']);
    run([
      'exec',
      name,
      'systemctl',
      'is-active',
      '--quiet',
      'arkvory-api',
      'arkvory-worker',
      'arkvory-database',
    ]);
    const before = run([
      'exec',
      name,
      'sha256sum',
      '/opt/proanima-arkvory/config/runtime.json',
      '/opt/proanima-arkvory/database/cluster/PG_VERSION',
    ]);
    // Probe inside the network namespace: production binds the API to loopback by default.
    run([
      'exec',
      name,
      '/opt/proanima-arkvory/runtime/node',
      '--input-type=module',
      '-e',
      "import {readFile} from 'node:fs/promises'; const token=await readFile('/opt/proanima-arkvory/config/health-token.txt','utf8'); const r=await fetch('http://127.0.0.1:8080/health/ready',{headers:{Authorization:'Bearer '+token}}); if(r.status!==200)process.exit(1);",
    ]);
    run(['exec', name, 'dnf', 'reinstall', '-y', '/candidate/Arkvory-x86_64.rpm']);
    run(['exec', name, 'dnf', 'remove', '-y', 'proanima-arkvory']);
    assert.equal(
      run([
        'exec',
        name,
        'sha256sum',
        '/opt/proanima-arkvory/config/runtime.json',
        '/opt/proanima-arkvory/database/cluster/PG_VERSION',
      ]),
      before,
    );
    console.log(
      'Fedora 44 RPM: dependency installation, readiness, reinstall and retained data passed',
    );
  } catch (error) {
    if (created) {
      console.error(run(['logs', name]));
      if (run(['inspect', '--format', '{{.State.Running}}', name]) === 'true')
        console.error(
          run([
            'exec',
            name,
            'journalctl',
            '-u',
            'arkvory-database',
            '-u',
            'arkvory-api',
            '-n',
            '60',
            '--no-pager',
          ]),
        );
    }
    throw error;
  } finally {
    if (created) run(['rm', '-f', name]);
    run(['image', 'rm', name]);
  }
}

import { execFileSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

export async function exerciseRpm(output) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const name = `depot-rpm-gate-${process.pid}`;
  const directory = await mkdtemp(join(tmpdir(), 'depot-rpm-gate-'));
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
      '-v',
      `${output}:/candidate:ro`,
      name,
    ]);
    created = true;
    run(['exec', name, 'dnf', 'install', '-y', '/candidate/Depot-x86_64.rpm']);
    run([
      'exec',
      name,
      'systemctl',
      'is-active',
      '--quiet',
      'depot-api',
      'depot-worker',
      'depot-database',
    ]);
    const before = run([
      'exec',
      name,
      'sha256sum',
      '/opt/proanima-depot/config/runtime.json',
      '/opt/proanima-depot/database/cluster/PG_VERSION',
    ]);
    // Probe inside the network namespace: production binds the API to loopback by default.
    run([
      'exec',
      name,
      '/opt/proanima-depot/runtime/node',
      '--input-type=module',
      '-e',
      "import {readFile} from 'node:fs/promises'; const token=await readFile('/opt/proanima-depot/config/health-token.txt','utf8'); const r=await fetch('http://127.0.0.1:8080/health/ready',{headers:{Authorization:'Bearer '+token}}); if(r.status!==200)process.exit(1);",
    ]);
    run(['exec', name, 'dnf', 'reinstall', '-y', '/candidate/Depot-x86_64.rpm']);
    run(['exec', name, 'dnf', 'remove', '-y', 'proanima-depot']);
    assert.equal(
      run([
        'exec',
        name,
        'sha256sum',
        '/opt/proanima-depot/config/runtime.json',
        '/opt/proanima-depot/database/cluster/PG_VERSION',
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
            'depot-database',
            '-u',
            'depot-api',
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

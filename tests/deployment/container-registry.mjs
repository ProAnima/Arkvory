import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const registry = '127.0.0.1:8080';

/**
 * The Docker CLI against the installed API (ADR 0063): login with the key, build, push, remove,
 * pull and read a file back. A private DOCKER_CONFIG keeps the credential out of the runner's own
 * Docker configuration; 127.0.0.0/8 is an insecure registry by default, so HTTP on the published
 * port is accepted. The image is FROM scratch: nothing is pulled from the internet.
 */
export async function exerciseImageRegistry(token, temporary) {
  const config = join(temporary, 'docker-config');
  const context = join(temporary, 'image');
  await mkdir(config, { recursive: true });
  await mkdir(context, { recursive: true });
  const marker = randomUUID();
  await writeFile(join(context, 'marker.txt'), marker);
  await writeFile(join(context, 'Dockerfile'), 'FROM scratch\nCOPY marker.txt /marker.txt\n');
  const docker = (args, input) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      input,
      env: { ...process.env, DOCKER_CONFIG: config },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  const image = `${registry}/releases/gate/smoke:${marker.slice(0, 8)}`;
  let container;
  try {
    docker(['login', registry, '--username', 'gate', '--password-stdin'], token);
    docker(['build', '--quiet', '--tag', image, context]);
    docker(['push', image]);
    const head = await fetch(
      `http://${registry}/v2/releases/gate/smoke/manifests/${marker.slice(0, 8)}`,
      {
        method: 'HEAD',
        headers: { authorization: `Basic ${Buffer.from(`gate:${token}`).toString('base64')}` },
      },
    );
    assert.equal(head.status, 200, 'the pushed tag resolves in the registry');
    const digest = head.headers.get('docker-content-digest');
    docker(['image', 'rm', image]);
    docker(['pull', image]);
    assert.match(
      docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', image]),
      new RegExp(digest),
    );
    // A created, never started container gives the file back as it was built.
    container = docker(['create', image, '/none']).trim();
    const copy = join(temporary, 'marker-copy.txt');
    docker(['cp', `${container}:/marker.txt`, copy]);
    assert.equal(await readFile(copy, 'utf8'), marker);
  } finally {
    if (container) docker(['rm', container]);
    try {
      docker(['image', 'rm', '--force', image]);
    } catch {}
    await rm(config, { recursive: true, force: true });
  }
}

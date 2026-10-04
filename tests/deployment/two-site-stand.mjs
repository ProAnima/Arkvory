import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { selfSignedCertificate } from '../tls-certificate.mjs';
import { docker, standImage, standNetwork, until } from './stand-hosts.mjs';

/*
 * Two-site stand (docs/SECOND_SITE.md): two Linux hosts with systemd, each with its own
 * installation from the native .deb, on one Docker network. A serves HTTPS with a certificate
 * of its own authority for the name arkvory-a; B mirrors A through `arkvory configure --mirror`
 * with that authority (--mirror-ca-file), follows it, keeps serving when A is cut off, and
 * after `--mirror-detach` accepts writes as the new primary.
 */
if (process.platform !== 'linux') throw new Error('The two-site stand needs a Linux Docker host');
const artifact = resolve(process.env.ARKVORY_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
const root = '/opt/proanima-arkvory';
const arkvory = (host, args, env = []) =>
  host.exec(['arkvory', 'configure', '--root', root, ...args], { env });

const work = await mkdtemp(join(tmpdir(), 'arkvory-stand-'));
const stand = standNetwork();
let passed = false;
try {
  const image = await standImage();
  const a = stand.start('arkvory-a', image);
  const b = stand.start('arkvory-b', image);
  await Promise.all([a.booted(), b.booted()]);
  for (const host of [a, b]) {
    host.exec(['mkdir', '-p', '/stand', '/etc/arkvory']);
    host.copy(join(artifact, 'Arkvory-amd64.deb'), '/stand/Arkvory-amd64.deb');
    host.copy(resolve('tests/deployment/stand-probe.mjs'), '/stand/stand-probe.mjs');
  }
  // Both installations at once: the postinst installs, migrates and starts the services.
  await Promise.all(
    [a, b].map(async (host) => {
      host.exec(['dpkg', '-i', '/stand/Arkvory-amd64.deb']);
      // No update polling against the hub or GitHub from a test host.
      host.exec(['systemctl', 'stop', 'arkvory-update.timer']);
    }),
  );

  // A: HTTPS for the name the mirror uses, from an authority B is told to trust.
  const certificate = selfSignedCertificate({ names: ['arkvory-a'] });
  await writeFile(join(work, 'cert.pem'), certificate.cert);
  await writeFile(join(work, 'key.pem'), certificate.key);
  a.copy(join(work, 'cert.pem'), '/etc/arkvory/cert.pem');
  a.copy(join(work, 'key.pem'), '/etc/arkvory/key.pem');
  a.exec(['chown', 'root:arkvory', '/etc/arkvory/cert.pem', '/etc/arkvory/key.pem']);
  a.exec(['chmod', '0640', '/etc/arkvory/cert.pem', '/etc/arkvory/key.pem']);
  arkvory(a, [
    '--tls-cert',
    '/etc/arkvory/cert.pem',
    '--tls-key',
    '/etc/arkvory/key.pem',
    '--listen-host',
    '0.0.0.0',
  ]);
  const onA = { url: 'https://arkvory-a:8080', ca: '/etc/arkvory/cert.pem' };
  a.probe('ready', onA);

  // Content on A before the mirror exists: the seed brings it, then the feed.
  const first = a.probe('publish', { ...onA, name: 'first.bin', size: 20 * 1024 * 1024 });
  const firstImage = a.probe('image', { ...onA, image: 'team/web', tag: '1.0' });
  const { secret } = a.probe('mirror-key', onA);

  // B: the mirror, through the installer, trusting A's authority and nothing else extra.
  b.copy(join(work, 'cert.pem'), '/etc/arkvory/a-ca.pem');
  await writeFile(join(work, 'a.token'), secret);
  b.copy(join(work, 'a.token'), '/etc/arkvory/a.token');
  b.exec(['chmod', '0600', '/etc/arkvory/a.token']);
  const attach = [
    '--mirror',
    'releases',
    '--mirror-upstream',
    'https://arkvory-a:8080',
    '--mirror-token-file',
    '/etc/arkvory/a.token',
  ];
  // Without A's authority the installer refuses before any change; TLS is not relaxed.
  assert.throws(() => arkvory(b, attach), /verified TLS/);
  arkvory(b, [...attach, '--mirror-ca-file', '/etc/arkvory/a-ca.pem']);
  const onB = { url: 'http://127.0.0.1:8080' };
  const caughtUp = () => {
    const status = b.probe('status', onB);
    return status.caughtUp === true && status.errorCode === null ? status : null;
  };
  await until(caughtUp, 'B to seed from A');
  assert.equal(b.probe('content', { ...onB, id: first.id }).sha256, first.sha256);
  assert.equal(
    b.probe('manifest', { ...onB, image: 'team/web', reference: '1.0' }).digest,
    firstImage.digest,
  );
  assert.equal(b.probe('can-write', onB).reason, 'mirror_read_only');

  // Changes on A arrive through the feed.
  const second = a.probe('publish', { ...onA, name: 'second.bin', size: 512 * 1024 });
  const secondImage = a.probe('image', { ...onA, image: 'team/web', tag: '2.0' });
  await until(
    () => b.probe('content', { ...onB, id: second.id }).sha256 === second.sha256,
    'B to follow A',
  );
  await until(
    () =>
      b.probe('manifest', { ...onB, image: 'team/web', reference: '2.0' }).digest ===
      secondImage.digest,
    'the new image on B',
  );

  // A is cut off: B keeps serving and its status says why it is behind.
  docker(['network', 'disconnect', stand.network, a.container]);
  a.probe('publish', { ...onA, url: 'https://127.0.0.1:8080', name: 'unseen.bin', size: 1024 });
  await until(() => b.probe('status', onB).errorCode !== null, 'B to report the lost source');
  assert.equal(b.probe('content', { ...onB, id: first.id }).sha256, first.sha256);

  // Failover: B becomes the primary and accepts writes; its copies stay.
  arkvory(b, ['--mirror-detach', 'releases']);
  assert.equal(b.probe('status', onB).status, 404, 'no mirror any more');
  assert.equal(b.probe('can-write', onB).status, 201);
  const promoted = b.probe('publish', { ...onB, name: 'after-failover.bin', size: 4096 });
  assert.equal(b.probe('content', { ...onB, id: promoted.id }).sha256, promoted.sha256);
  assert.equal(b.probe('content', { ...onB, id: second.id }).sha256, second.sha256);
  passed = true;
  console.log(
    'Two-site stand: packaged installs, HTTPS with an own CA, mirror seed and follow incl. images, source loss and failover passed',
  );
} catch (error) {
  for (const host of stand.hosts) console.error(`--- ${host.name}\n${host.journal()}`);
  throw error;
} finally {
  await stand.remove();
  // Kept after a failure for diagnosis, like the other deployment gates.
  if (passed) await rm(work, { recursive: true, force: true });
}

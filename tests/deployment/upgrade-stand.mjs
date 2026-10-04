import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { standImage, standNetwork } from './stand-hosts.mjs';

/*
 * Upgrade stand (docs/UPDATES.md): a Linux host with systemd installs the latest published
 * release from its .deb and gets content. The candidate's .deb is then installed over it as an
 * operator would: without a backup vault the package refuses before any change and the old
 * release keeps serving; with a vault and a first backup its postinst captures and verifies a
 * fresh backup, migrates and starts the candidate. The content stays and the candidate's
 * protocols work on the migrated schema. The previous release comes from
 * ARKVORY_PREVIOUS_RELEASE (a folder of its assets) or from the latest GitHub release, checked
 * against that release's native-linux.json.
 */
if (process.platform !== 'linux') throw new Error('The upgrade stand needs a Linux Docker host');
const candidate = resolve(process.env.ARKVORY_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
const latest = 'https://github.com/ProAnima/Arkvory/releases/latest/download/';
const root = '/opt/proanima-arkvory';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function previousRelease(work) {
  const local = process.env.ARKVORY_PREVIOUS_RELEASE;
  const read = async (name) => {
    if (local) return readFile(join(local, name));
    const response = await fetch(latest + name, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Previous release ${name}: HTTP ${String(response.status)}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const listing = JSON.parse((await read('native-linux.json')).toString('utf8'));
  const deb = await read('Arkvory-amd64.deb');
  assert.equal(sha256(deb), listing.files['Arkvory-amd64.deb'], 'previous release .deb checksum');
  const path = join(work, 'previous.deb');
  await writeFile(path, deb);
  return { version: listing.version, path };
}

const work = await mkdtemp(join(tmpdir(), 'arkvory-upgrade-'));
const stand = standNetwork();
let passed = false;
try {
  const previous = await previousRelease(work);
  const release = JSON.parse(await readFile(join(candidate, 'native-linux.json'), 'utf8'));
  const host = stand.start('arkvory-upgrade', await standImage());
  await host.booted();
  host.exec(['mkdir', '-p', '/stand']);
  host.copy(previous.path, '/stand/previous.deb');
  host.copy(join(candidate, 'Arkvory-amd64.deb'), '/stand/candidate.deb');
  host.copy(resolve('tests/deployment/stand-probe.mjs'), '/stand/stand-probe.mjs');
  const version = () => host.exec(['dpkg-query', '-W', '-f=${Version}', 'proanima-arkvory']);
  host.exec(['dpkg', '-i', '/stand/previous.deb']);
  // No update polling against the hub or GitHub from a test host.
  host.exec(['systemctl', 'stop', 'arkvory-update.timer']);
  assert.equal(version(), previous.version);
  const on = { url: 'http://127.0.0.1:8080' };
  host.probe('ready', on);
  const kept = [
    host.probe('publish', { ...on, name: 'before-upgrade.bin', size: 6 * 1024 * 1024 }),
    host.probe('publish', { ...on, name: 'small.bin', size: 1024 }),
  ];

  // A schema change without a backup vault: refused before any change, the old release serves.
  assert.throws(() => host.exec(['dpkg', '-i', '/stand/candidate.deb']));
  host.probe('ready', on);
  for (const item of kept)
    assert.equal(host.probe('content', { ...on, id: item.id }).sha256, item.sha256);

  // The operator's path: a vault and its first backup, then the candidate again.
  host.exec(['mkdir', '-p', '/var/lib/arkvory-vault']);
  host.exec([
    'arkvory',
    'configure',
    '--root',
    root,
    '--backup-vault',
    '/var/lib/arkvory-vault',
    '--init-vault',
  ]);
  host.probe('backup-capture', on);
  const installed = host.exec(['dpkg', '-i', '/stand/candidate.deb']);
  assert.match(installed, /with a database migration/);
  assert.equal(version(), release.version);
  host.probe('ready', on);
  for (const item of kept)
    assert.equal(host.probe('content', { ...on, id: item.id }).sha256, item.sha256);
  const image = host.probe('image', { ...on, image: 'team/web', tag: '1.0' });
  assert.equal(
    host.probe('manifest', { ...on, image: 'team/web', reference: '1.0' }).digest,
    image.digest,
  );
  assert.deepEqual(host.probe('protocols', on), { raw: true, lfs: true, npm: '1.0.0' });
  passed = true;
  console.log(
    `Upgrade stand: ${previous.version} .deb with content, refusal without a vault, migration behind a verified backup to ${release.version}, content kept, image registry, raw files, Git LFS and npm passed`,
  );
} catch (error) {
  for (const host of stand.hosts) console.error(`--- ${host.name}\n${host.journal()}`);
  throw error;
} finally {
  await stand.remove();
  // Kept after a failure for diagnosis, like the other deployment gates.
  if (passed) await rm(work, { recursive: true, force: true });
}

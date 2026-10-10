import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { standImage, standNetwork, until } from './stand-hosts.mjs';

/*
 * Backup vault on a NAS (ADR 0054, 0057): one host plays the NAS with an SMB 3 share (Samba) and
 * an NFS 4 export; the other has an installation from the native .deb and mounts them as an
 * operator would. On each share `arkvory configure --backup-vault --init-vault` sets up the
 * vault, the installed agent captures a point and a deep verification reads every byte back
 * from the share. Needs the cifs, nfs and nfsd modules of the Docker host's kernel: a disposable
 * CI runner loads them; a workstation's Docker VM is never changed by a gate.
 */
if (process.platform !== 'linux') throw new Error('The NAS stand needs a Linux Docker host');
const artifact = resolve(process.env.ARKVORY_NATIVE_ARTIFACT ?? 'test-results/native-candidate');
const root = '/opt/proanima-arkvory';
const onApp = { url: 'http://127.0.0.1:8080' };

const stand = standNetwork();
let passed = false;
try {
  const image = await standImage();
  // Above the vault's free-space reserve (1 GiB): tmpfs takes memory only for written data.
  const nas = stand.start('nas', image, { tmpfs: ['/export:rw,size=4g'] });
  const app = stand.start('app', image);
  await Promise.all([nas.booted(), app.booted()]);
  const filesystems = app.exec(['cat', '/proc/filesystems']);
  for (const kind of ['cifs', 'nfs4'])
    if (!filesystems.includes(kind))
      throw new Error(`The Docker host kernel has no ${kind}: load cifs, nfs and nfsd first`);

  // The NAS: an SMB share for a user of its own and an NFS export, both empty.
  const password = randomBytes(18).toString('base64url');
  nas.exec(['mkdir', '-p', '/export/smb', '/export/nfs']);
  nas.exec(['useradd', '--no-create-home', '--shell', '/usr/sbin/nologin', 'nasbackup']);
  nas.exec(['chown', 'nasbackup:nasbackup', '/export/smb']);
  nas.exec(['smbpasswd', '-a', '-s', 'nasbackup'], { input: `${password}\n${password}\n` });
  nas.exec(['tee', '-a', '/etc/samba/smb.conf'], {
    input: '[vault]\n   path = /export/smb\n   read only = no\n   valid users = nasbackup\n',
  });
  nas.exec(['tee', '/etc/exports'], {
    // The NFSv4 root (fsid=0): tmpfs has no device the export could be named by otherwise.
    input: '/export *(rw,sync,no_subtree_check,no_root_squash,fsid=0)\n',
  });
  nas.exec(['systemctl', 'unmask', 'smbd.service', 'nfs-server.service']);
  nas.exec(['systemctl', 'start', 'smbd.service', 'nfs-server.service']);
  nas.exec(['exportfs', '-ra']);

  // The application host: the package, then content worth backing up.
  app.exec(['mkdir', '-p', '/stand', '/etc/arkvory', '/mnt/smb-vault', '/mnt/nfs-vault']);
  app.copy(join(artifact, 'Arkvory-amd64.deb'), '/stand/Arkvory-amd64.deb');
  app.copy(resolve('tests/deployment/stand-probe.mjs'), '/stand/stand-probe.mjs');
  app.exec(['dpkg', '-i', '/stand/Arkvory-amd64.deb']);
  app.exec(['systemctl', 'stop', 'arkvory-update.timer']);
  app.probe('ready', onApp);
  const published = app.probe('publish', { ...onApp, name: 'nas.bin', size: 8 * 1024 * 1024 });

  const vaultReady = () => {
    const status = app.probe('backup-status', onApp);
    return status.agent.online && status.vault.available && status.vault.id !== null;
  };
  // `create`: a new plain vault; otherwise the vault already on the share is used as is.
  const capture = async (vault, share, exportPath, create = true) => {
    app.exec([
      'arkvory',
      'configure',
      '--root',
      root,
      '--backup-vault',
      vault,
      ...(create ? ['--init-vault', '--vault-no-encryption'] : []),
    ]);
    await until(vaultReady, `the agent to report the vault on ${share}`);
    const point = app.probe('backup-capture', onApp);
    assert.ok(point.blobs >= 1, `the point on ${share} holds the published blob`);
    assert.equal(app.probe('backup-verify', { ...onApp, point: point.pointId }).state, 'completed');
    // Committed where the NAS keeps it, not only in the mount's cache.
    nas.exec(['test', '-f', `${exportPath}/points/${point.pointId}/COMMITTED`]);
    return point;
  };

  // SMB 3: the share's files appear owned by the agent's account through the mount options.
  app.exec(['tee', '/etc/arkvory/smb.credentials'], {
    input: `username=nasbackup\npassword=${password}\n`,
  });
  app.exec(['chmod', '0600', '/etc/arkvory/smb.credentials']);
  const uid = app.exec(['id', '-u', 'arkvory']);
  const gid = app.exec(['id', '-g', 'arkvory']);
  const smb = (options) =>
    app.exec([
      'mount',
      '-t',
      'cifs',
      '//nas/vault',
      '/mnt/smb-vault',
      '-o',
      `credentials=/etc/arkvory/smb.credentials,${options}vers=3.1.1`,
    ]);
  // A frequent mistake first: mounted without the agent's account, the share is root's and the
  // agent cannot write there. The installer must refuse clearly and keep the agent as it was.
  smb('');
  assert.throws(
    () =>
      app.exec([
        'arkvory',
        'configure',
        '--root',
        root,
        '--backup-vault',
        '/mnt/smb-vault',
        '--init-vault',
        '--vault-no-encryption',
      ]),
    (error) => {
      console.log(`Refused as expected: ${String(error.stderr).trim().split('\n').at(-1)}`);
      return true;
    },
  );
  assert.equal(app.probe('backup-status', onApp).vault.configured, false);
  app.exec(['umount', '/mnt/smb-vault']);
  smb(`uid=${uid},gid=${gid},file_mode=0600,dir_mode=0700,`);
  // The refused attempt created the vault before the agent failed to open it; configure keeps
  // it, and asking to create it again is refused. The operator connects the existing vault.
  nas.exec(['test', '-f', '/export/smb/vault.json']);
  const onSmb = await capture('/mnt/smb-vault', 'SMB', '/export/smb', false);

  // NFS 4: ownership as on a local disk.
  app.exec(['mount', '-t', 'nfs4', 'nas:/nfs', '/mnt/nfs-vault']);
  const onNfs = await capture('/mnt/nfs-vault', 'NFS', '/export/nfs');
  assert.notEqual(onSmb.pointId, onNfs.pointId);
  assert.ok(published.id);
  passed = true;
  console.log(
    'NAS stand: backup vault on SMB 3 and NFS 4 shares, capture and deep verification passed',
  );
} catch (error) {
  for (const host of stand.hosts) console.error(`--- ${host.name}\n${host.journal()}`);
  throw error;
} finally {
  if (passed || !process.env.ARKVORY_KEEP_STAND) await stand.remove();
}

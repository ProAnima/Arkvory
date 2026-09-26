import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteSsh, discoverHost } from '../apps/deploy/dist/remote-ssh.js';
import { remoteInput, remoteOwner } from '../apps/deploy/dist/remote-model.js';
import { inspectTarget, installCommand, remoteNode } from '../apps/deploy/dist/remote-target.js';
import { createRemoteWizard } from '../apps/deploy/dist/remote-server.js';
import { openTunnel } from '../apps/deploy/dist/remote-tunnel.js';
import { RemoteWorkflow } from '../apps/deploy/dist/remote-workflow.js';
import { GitHubReleases } from '../apps/deploy/dist/github.js';

const form = () =>
  new URLSearchParams({
    host: '127.0.0.1',
    port: '22',
    username: 'root',
    password: 'private-ssh-password',
    platform: 'linux',
    owner: 'admin',
    ownerPassword: 'private-owner-password',
  });
async function sshServer(t) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const connections = new Set(),
    authenticated = [],
    requests = [],
    uploaded = [];
  const web = createServer((req, res) => res.end('forwarded-content'));
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
    connections.add(client);
    client.on('error', () => undefined);
    client.on('close', () => connections.delete(client));
    client.on('authentication', (ctx) => {
      authenticated.push(ctx.username);
      if (ctx.method === 'password' && ctx.password === 'private-ssh-password') ctx.accept();
      else ctx.reject();
    });
    client.on('session', (accept) =>
      accept()
        .on('sftp', (accept) => {
          const sftp = accept();
          sftp.on('OPEN', (id, path, flags) => {
            assert.equal(path, '/private/installer');
            assert.ok(flags & ssh2.utils.sftp.OPEN_MODE.EXCL);
            sftp.handle(id, Buffer.from('file'));
          });
          sftp.on('WRITE', (id, handle, offset, data) => {
            uploaded.push(Buffer.from(data));
            sftp.status(id, 0);
          });
          sftp.on('CLOSE', (id) => sftp.status(id, 0));
        })
        .on('exec', (accept, reject, info) => {
          requests.push(info.command);
          const stream = accept();
          if (info.command === 'hang') return;
          if (info.command === 'huge') {
            stream.write('x'.repeat(66000));
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command.includes('id -u')) {
            stream.write('deb\nnew\n');
            stream.exit(0);
            stream.end();
            return;
          }
          let input = '';
          stream.on('data', (data) => {
            input += data;
          });
          stream.on('end', () => {
            stream.write(input);
            stream.exit(0);
            stream.end();
          });
        }),
    );
    client.on('tcpip', (accept, reject, info) => {
      requests.push({ destIP: info.destIP, destPort: info.destPort });
      const socket = connect(web.address().port, '127.0.0.1'),
        channel = accept();
      socket.on('error', () => channel.destroy());
      channel.on('error', () => socket.destroy());
      channel.once('close', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const c of connections) c.end();
    server.close();
    web.closeAllConnections();
    web.close();
  });
  const input = remoteInput(form());
  input.port = server.address().port;
  return { input, authenticated, requests, uploaded };
}

test('SSH discovery never authenticates; a mismatched host key cannot receive credentials', async (t) => {
  const f = await sshServer(t),
    fingerprint = await discoverHost(f.input);
  assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.deepEqual(f.authenticated, []);
  const bad = new RemoteSsh();
  t.after(() => bad.close());
  await assert.rejects(bad.connect(f.input, 'SHA256:wrong'), { code: 'ssh' });
  assert.deepEqual(f.authenticated, []);
  const ssh = new RemoteSsh();
  t.after(() => ssh.close());
  await ssh.connect(f.input, fingerprint);
  assert.deepEqual(await inspectTarget(ssh, 'linux'), {
    platform: 'linux',
    packaging: 'deb',
    installed: false,
  });
  assert.equal(await ssh.exec('echo-input', 'secret over stdin'), 'secret over stdin');
  assert.ok(f.requests.every((r) => typeof r !== 'string' || !r.includes('secret over stdin')));
  await assert.rejects(ssh.exec('huge'), { code: 'command' });
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-ssh-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = Buffer.from('verified installer bytes');
  await writeFile(join(directory, 'installer'), data);
  await ssh.upload(join(directory, 'installer'), '/private/installer');
  assert.deepEqual(Buffer.concat(f.uploaded), data);
  const tunnel = await openTunnel(ssh);
  t.after(tunnel.close);
  assert.equal(await (await fetch(tunnel.url)).text(), 'forwarded-content');
  assert.deepEqual(f.requests.at(-1), { destIP: '127.0.0.1', destPort: 8080 });
  await assert.rejects(ssh.exec('hang', '', 30), { code: 'timeout' });
  assert.equal(ssh.active, false);
});

test('closing during installation preparation is terminal and clears credentials', async () => {
  const input = remoteInput(form()),
    workflow = new RemoteWorkflow(input);
  workflow.state.phase = 'review';
  workflow.state.target = { platform: 'linux', packaging: 'deb', installed: false };
  const pending = workflow.install(remoteOwner(form()));
  workflow.close();
  await pending;
  assert.equal(workflow.state.phase, 'closed');
  assert.equal(input.password, '');
  assert.equal(input.githubToken, '');
  assert.equal(workflow.active, false);
  await assert.rejects(workflow.install(remoteOwner(form())), { code: 'state' });
});

test('native release selection rejects prereleases, tag drift, duplicate assets and malformed hashes', async (t) => {
  const api = 'https://api.github.com/repos/ProAnima/Arkvory/releases';
  const release = {
    draft: false,
    prerelease: false,
    tag_name: 'v1.2.3',
    assets: [
      { name: 'native-linux.json', url: `${api}/assets/1` },
      { name: 'Arkvory-amd64.deb', url: `${api}/assets/2` },
    ],
  };
  const manifest = {
    version: '1.2.3',
    commit: 'a'.repeat(40),
    files: { 'Arkvory-amd64.deb': 'b'.repeat(64) },
  };
  t.mock.method(globalThis, 'fetch', async (url) =>
    Response.json(String(url).endsWith('/latest') ? release : manifest),
  );
  const github = new GitHubReleases('');
  assert.equal((await github.native('linux', 'Arkvory-amd64.deb')).version, '1.2.3');
  release.prerelease = true;
  await assert.rejects(github.native('linux', 'Arkvory-amd64.deb'), /stable/i);
  release.prerelease = false;
  release.tag_name = 'v1.2.4';
  await assert.rejects(github.native('linux', 'Arkvory-amd64.deb'), /identity/);
  release.tag_name = 'v1.2.3';
  manifest.files['Arkvory-amd64.deb'] = 'broken';
  await assert.rejects(github.native('linux', 'Arkvory-amd64.deb'), /identity/);
  manifest.files['Arkvory-amd64.deb'] = 'b'.repeat(64);
  release.assets.push(release.assets[1]);
  await assert.rejects(github.native('linux', 'Arkvory-amd64.deb'), /asset/);
});

test('closing release download aborts its stream and removes partial bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-release-abort-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new Uint8Array([1, 2, 3]));
        options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {
          once: true,
        });
      },
    });
    setImmediate(() => controller.abort());
    return new Response(body);
  });
  const path = join(directory, 'installer');
  await assert.rejects(
    new GitHubReleases('', controller.signal).download(
      'https://api.github.com/asset',
      path,
      'a'.repeat(64),
    ),
    { name: 'AbortError' },
  );
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(path), { code: 'ENOENT' });
});

test('remote inputs and command boundaries reject unsafe controls and preserve literal paths', () => {
  for (const [key, value] of [
    ['host', '-oProxyCommand=evil'],
    ['host', 'host;command'],
    ['port', '0'],
    ['username', 'root;id'],
    ['platform', 'other'],
    ['githubToken', 'token\nheader'],
  ]) {
    const input = form();
    input.set(key, value);
    assert.throws(() => remoteInput(input));
  }
  assert.throws(() => remoteOwner(new URLSearchParams({ owner: 'admin', ownerPassword: 'short' })));
  assert.equal(remoteOwner(form()).owner, 'admin');
  const linux = { platform: 'linux', packaging: 'deb', installed: false },
    hash = 'a'.repeat(64);
  const command = installCommand(linux, "/var/tmp/a'b/pkg.deb", hash);
  assert.ok(command.indexOf('sha256sum --check') < command.indexOf('apt-get install'));
  assert.ok(command.includes("'\\''"));
  assert.throws(() => installCommand(linux, '/tmp/a', 'no hash'));
  const windows = Buffer.from(
    installCommand(
      { ...linux, platform: 'windows', packaging: 'exe' },
      'C:/ProgramData/a.exe',
      hash,
    )
      .split(' ')
      .at(-1),
    'base64',
  ).toString('utf16le');
  assert.match(windows, /-WindowStyle Hidden/);
  assert.ok(windows.indexOf('Get-FileHash') < windows.indexOf('Start-Process'));
  const node = Buffer.from(
    remoteNode('windows', 'console.log(1)').split(' ').at(-1),
    'base64',
  ).toString('utf16le');
  assert.match(node, /C:\/ProgramData\/ProAnima\/Arkvory\/runtime\/node.exe/);
});

test('wizard requires one-time entry, exact origin, session cookie and CSRF; secrets are not reflected', async (t) => {
  let captured,
    installations = 0,
    closed = 0;
  const job = {
    state: {
      destination: 'root@127.0.0.1:22',
      phase: 'fingerprint',
      fingerprint: 'SHA256:test',
      target: null,
      version: '',
      url: '',
      error: '',
    },
    active: true,
    discover: async () => {},
    inspect: async () => {
      job.state.phase = 'review';
    },
    install: async () => {
      installations++;
      job.state.phase = 'install';
    },
    close: () => {
      closed++;
    },
  };
  const wizard = await createRemoteWizard({
    factory: (input) => {
      captured = input;
      return job;
    },
  });
  t.after(wizard.close);
  const origin = new URL(wizard.url).origin;
  assert.equal((await fetch(origin)).status, 403);
  const entry = await fetch(wizard.url, { redirect: 'manual' }),
    cookie = entry.headers.get('set-cookie').split(';')[0];
  assert.equal(entry.status, 303);
  assert.equal((await fetch(wizard.url)).status, 403);
  const page = await fetch(origin, { headers: { cookie } }),
    html = await page.text();
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const post = (path, data, from = origin) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { cookie, origin: from },
      body: data,
      redirect: 'manual',
    });
  const input = form();
  input.set('csrf', csrf);
  assert.equal((await post('/discover', input, 'https://evil.example')).status, 403);
  assert.equal((await post('/discover', new URLSearchParams({ csrf: 'wrong' }))).status, 403);
  assert.equal(captured, undefined);
  assert.equal((await post('/discover', input)).status, 303);
  assert.equal(captured.password, 'private-ssh-password');
  const view = await (await fetch(origin, { headers: { cookie } })).text();
  assert.ok(!view.includes(captured.password));
  assert.equal(captured.ownerPassword, undefined);
  await post('/install', new URLSearchParams({ csrf }));
  assert.equal(installations, 0);
  await post('/inspect', new URLSearchParams({ csrf, trusted: 'yes' }));
  await post(
    '/install',
    new URLSearchParams({ csrf, owner: 'admin', ownerPassword: 'private-owner-password' }),
  );
  await post(
    '/install',
    new URLSearchParams({ csrf, owner: 'admin', ownerPassword: 'private-owner-password' }),
  );
  assert.equal(installations, 1);
  await post('/reset', new URLSearchParams({ csrf }));
  assert.equal(closed, 1);
});

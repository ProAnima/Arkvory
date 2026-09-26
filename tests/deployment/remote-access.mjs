import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';
import ssh2 from 'ssh2';
import { RemoteWorkflow } from '../../apps/deploy/dist/remote-workflow.js';
import { RemoteSsh, discoverHost } from '../../apps/deploy/dist/remote-ssh.js';
import { remoteNode } from '../../apps/deploy/dist/remote-target.js';

// Real command execution is restricted to the same disposable runner as native-install.
// The SSH transport is loopback-only; native services/readiness and shell stdin are real.
export async function exerciseRemoteAccess() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const password = randomBytes(24).toString('hex'),
    clients = new Set();
  const server = new ssh2.Server({ hostKeys: [key] }, (client) => {
    clients.add(client);
    client.on('error', () => undefined);
    client.once('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === password) ctx.accept();
      else ctx.reject();
    });
    client.on('session', (accept) =>
      accept().on('exec', (accept, reject, info) => {
        const channel = accept();
        const child =
          process.platform === 'win32'
            ? spawn('cmd.exe', ['/d', '/s', '/c', info.command], { windowsHide: true })
            : spawn('sudo', ['-n', 'bash', '-c', info.command]);
        channel.pipe(child.stdin);
        child.stdout.pipe(channel, { end: false });
        child.stderr.pipe(channel.stderr, { end: false });
        child.stdin.on('error', () => undefined);
        channel.on('error', () => undefined);
        child.once('error', () => {
          channel.exit(1);
          channel.end();
        });
        child.once('close', (code) => {
          channel.exit(code ?? 1);
          channel.end();
        });
        channel.once('close', () => {
          child.kill();
        });
      }),
    );
    client.on('tcpip', (accept, reject, info) => {
      assert.equal(info.destIP, '127.0.0.1');
      assert.equal(info.destPort, 8080);
      const channel = accept(),
        socket = connect(8080, '127.0.0.1');
      socket.on('error', () => channel.destroy());
      channel.on('error', () => socket.destroy());
      channel.once('close', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const input = {
    host: '127.0.0.1',
    port: server.address().port,
    username: 'arkvory-acceptance',
    password,
    privateKey: '',
    passphrase: '',
    githubToken: '',
    platform: process.platform === 'win32' ? 'windows' : 'linux',
  };
  const workflow = new RemoteWorkflow({ ...input }),
    ssh = new RemoteSsh();
  try {
    await ssh.connect(input, await discoverHost(input));
    const sample = Buffer.from('Пароль-UTF8-驗證').toString('base64');
    const script =
      "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(Buffer.from(data,'base64').toString('base64')));";
    assert.equal(await ssh.exec(remoteNode(input.platform, script), sample), sample);
    await workflow.discover();
    await workflow.inspect();
    assert.equal(workflow.state.phase, 'review', workflow.state.error);
    assert.equal(workflow.state.target.installed, true);
    await workflow.install();
    assert.equal(workflow.state.phase, 'ready', workflow.state.error);
    const response = await fetch(workflow.state.url + '/console/', {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    await response.body.cancel();
    console.log(
      'Remote SSH: real shell stdin, native readiness/worker and forwarded console passed',
    );
  } finally {
    ssh.close();
    workflow.close();
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  }
}

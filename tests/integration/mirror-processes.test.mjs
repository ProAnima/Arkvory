import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { selfSignedCertificate } from '../tls-certificate.mjs';
import { removeTestDirectory } from '../helpers.mjs';
import { base, setup } from './fixture.mjs';
import { mirrorInstance, publish } from './mirror-fixture.mjs';

/**
 * A TCP relay in front of the source: `down()` refuses connections on the same port, as a
 * source host that went away would, and `up()` relays again. TLS passes through untouched.
 */
async function relay(t, target) {
  let open = true;
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    if (!open) return socket.destroy();
    const upstream = connect(target, '127.0.0.1');
    sockets.add(socket).add(upstream);
    const drop = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
    socket.pipe(upstream).pipe(socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const down = () => {
    open = false;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
  t.after(() => {
    down();
    return new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    down,
    up() {
      open = true;
    },
  };
}

/** The production worker of the mirror installation, synchronizing over HTTPS. */
function worker(t, mirror, files) {
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ARKVORY_DATABASE_URL: mirror.config.databaseUrl,
      ARKVORY_DATA_DIR: mirror.directory,
      ARKVORY_KEYS_FILE: files.keys,
      ARKVORY_MIRRORS_FILE: files.mirrors,
      ARKVORY_CAPACITY_BYTES: String(16 * 1024 ** 3),
      // The source's certificate is self-signed: its authority is stored like a corporate CA
      // (arkvory configure --mirror-ca-file) and trusted besides the defaults, never disabled.
      ARKVORY_MIRRORS_CA_FILE: files.ca,
    },
  });
  const handle = { child, output: '', ended: once(child, 'exit') };
  const keep = (chunk) => {
    handle.output = (handle.output + chunk).slice(-65536);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  handle.stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await handle.ended;
    }
  };
  mirror.release(() => handle.stop());
  return handle;
}

async function until(condition, what, handle, ms = 90_000) {
  const deadline = performance.now() + ms;
  for (;;) {
    const value = await condition();
    if (value) return value;
    if (performance.now() > deadline)
      throw new Error(`Timed out waiting for ${what}\n${handle?.output.slice(-4000) ?? ''}`);
    await delay(250);
  }
}

const status = async (mirror) =>
  (await mirror.app.inject({ url: `${base}/mirror`, headers: mirror.readerHeaders })).json();
const served = async (mirror, id) => {
  const response = await mirror.app.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: mirror.readerHeaders,
  });
  return response.statusCode === 200 ? response.rawPayload : null;
};
const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('two installations over TLS: the production worker mirrors, survives an outage, a rotated key and a restart', async (t) => {
  const certificate = selfSignedCertificate();
  const tlsDirectory = await mkdtemp(join(tmpdir(), 'arkvory-mirror-tls-'));
  t.after(() => removeTestDirectory(tlsDirectory));
  const ca = join(tlsDirectory, 'source.crt');
  const keyFile = join(tlsDirectory, 'source.key');
  await writeFile(ca, certificate.cert);
  await writeFile(keyFile, certificate.key, { mode: 0o600 });
  // The source: its own database and storage, built-in HTTPS on a loopback port.
  const source = await setup(t, {
    tls: { certificateFile: ca, keyFile, minVersion: 'TLSv1.3', reloadSeconds: 0 },
  });
  const listening = await source.listen();
  const front = await relay(t, Number(new URL(listening).port));
  const upstream = `https://localhost:${String(front.port)}`;

  const mirror = await mirrorInstance(t, upstream);
  const files = {
    ca,
    keys: join(mirror.directory, 'keys.json'),
    mirrors: join(mirror.directory, 'mirrors.json'),
    token: join(mirror.directory, 'source.token'),
  };
  await writeFile(
    files.keys,
    JSON.stringify(mirror.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  await writeFile(files.token, source.readerHeaders.authorization.slice(7));
  await writeFile(
    files.mirrors,
    JSON.stringify({
      mirrors: [
        { repository: 'releases', upstream, sourceRepository: 'releases', tokenFile: files.token },
      ],
    }),
  );

  // Seed and follow through the real worker process.
  const first = randomBytes(3 * 1024 * 1024);
  const firstId = await publish(source, first, 'first.bin');
  let running = worker(t, mirror, files);
  await until(async () => (await served(mirror, firstId))?.equals(first), 'the seed', running);
  await until(async () => (await status(mirror)).caughtUp === true, 'catching up', running);

  // The source goes away: the mirror keeps serving and its status shows the failure.
  front.down();
  const second = randomBytes(64 * 1024);
  const secondId = await publish(source, second, 'second.bin');
  await until(async () => (await status(mirror)).errorCode !== null, 'a failure', running);
  assert.deepEqual(await served(mirror, firstId), first);
  assert.equal(await served(mirror, secondId), null);

  // While it is away, its read key is rotated: the old one is refused once the source is back.
  const rotated = `read-${randomUUID()}${randomUUID()}`;
  const readerEntry = source.config.keys.find((key) => key.principal.id === 'test-reader');
  readerEntry.sha256 = createHash('sha256').update(rotated).digest('hex');
  front.up();
  await until(
    async () => (await status(mirror)).errorCode === 'unauthorized',
    'the refused old key',
    running,
  );
  // The worker reads the key file again after every failure: no restart needed.
  await writeFile(files.token, rotated);
  await until(async () => (await served(mirror, secondId))?.equals(second), 'recovery', running);
  await until(async () => (await status(mirror)).errorCode === null, 'a clean status', running);
  assert.match(running.output, /mirror\.recovered/);

  // A restarted worker continues from its cursor: nothing is seeded or copied twice.
  const before = await status(mirror);
  await running.stop();
  const third = randomBytes(32 * 1024);
  const thirdId = await publish(source, third, 'third.bin');
  running = worker(t, mirror, files);
  await until(async () => (await served(mirror, thirdId))?.equals(third), 'the restart', running);
  const after = await status(mirror);
  assert.equal(after.phase, 'following');
  assert.equal(after.copiedArtifacts, before.copiedArtifacts + 1);
  assert.equal(digestOf(await served(mirror, firstId)), digestOf(first));
});

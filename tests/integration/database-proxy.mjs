import { createServer as tcpServer, connect } from 'node:net';
import { once } from 'node:events';

export async function databaseProxy(f) {
  let stalled = false;
  const target = new URL(f.config.databaseUrl),
    sockets = new Set();
  const destination = { host: target.hostname, port: Number(target.port || 5432) };
  const server = tcpServer((client) => {
    const upstream = connect(destination);
    sockets.add(client);
    sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream).pipe(client);
    if (stalled) {
      client.pause();
      upstream.pause();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  f.cleanup.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );
  target.hostname = '127.0.0.1';
  target.port = String(server.address().port);
  return {
    url: target.toString(),
    stall() {
      stalled = true;
      for (const socket of sockets) socket.pause();
    },
    resume() {
      stalled = false;
      for (const socket of sockets) socket.resume();
    },
  };
}

import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { RemoteSsh } from './remote-ssh.js';

/** The tunnel exposes only the remote loopback API, never arbitrary ports or the database. */
export async function openTunnel(ssh: Pick<RemoteSsh, 'forward' | 'active'>) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    if (!ssh.active || sockets.size >= 32) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(120000, () => socket.destroy());
    void ssh
      .forward()
      .then((channel) => {
        if (socket.destroyed) {
          channel.destroy();
          return;
        }
        channel.on('error', () => socket.destroy());
        channel.once('close', () => socket.destroy());
        socket.once('close', () => channel.destroy());
        socket.pipe(channel).pipe(socket);
      })
      .catch(() => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Tunnel address unavailable');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

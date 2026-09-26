import ssh2 from 'ssh2';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { RemoteError } from './remote-model.js';
import type { RemoteInput } from './remote-model.js';

export const fingerprint = (key: Buffer) =>
  'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

/** Discovery rejects the host key before authentication; credentials are never sent to an untrusted host. */
export function discoverHost(input: Pick<RemoteInput, 'host' | 'port'>): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let seen = '';
    const timer = setTimeout(() => client.destroy(), 15000);
    client.on('error', () => undefined);
    client.once('close', () => {
      clearTimeout(timer);
      if (seen) resolve(seen);
      else reject(new RemoteError('ssh'));
    });
    client.connect({
      host: input.host,
      port: input.port,
      username: 'arkvory-host-check',
      readyTimeout: 10000,
      hostVerifier: (key: Buffer) => {
        seen = fingerprint(key);
        return false;
      },
    });
  });
}
export class RemoteSsh {
  private readonly client = new ssh2.Client();
  private closed = false;
  constructor() {
    this.client.on('error', () => undefined);
    this.client.on('close', () => {
      this.closed = true;
    });
  }
  async connect(input: RemoteInput, expected: string) {
    if (this.closed) throw new RemoteError('disconnected');
    await new Promise<void>((resolve, reject) => {
      const failed = () => {
        reject(new RemoteError('ssh'));
      };
      this.client.once('error', failed);
      this.client.once('close', failed);
      this.client.once('ready', () => {
        this.client.removeListener('error', failed);
        this.client.removeListener('close', failed);
        resolve();
      });
      this.client.connect({
        host: input.host,
        port: input.port,
        username: input.username,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        ...(input.privateKey
          ? { privateKey: input.privateKey, passphrase: input.passphrase }
          : { password: input.password }),
        hostVerifier: (key: Buffer) => fingerprint(key) === expected,
      });
    });
  }
  get active() {
    return !this.closed;
  }
  async exec(command: string, input = '', timeout = 60000): Promise<string> {
    if (this.closed) throw new RemoteError('disconnected');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new RemoteError('timeout'));
      }, timeout);
      const disconnected = () => {
        clearTimeout(timer);
        reject(new RemoteError('disconnected'));
      };
      this.client.once('close', disconnected);
      this.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          this.client.removeListener('close', disconnected);
          reject(new RemoteError('command'));
          return;
        }
        let output = '',
          exceeded = false;
        stream.on('data', (data: Buffer) => {
          if (output.length + data.length > 65536) exceeded = true;
          else output += data.toString('utf8');
        });
        // Do not reflect remote stdout/stderr in a UI or log: it may contain credentials.
        stream.stderr.resume();
        stream.on('error', () => undefined);
        stream.once('close', (code: number | null) => {
          clearTimeout(timer);
          this.client.removeListener('close', disconnected);
          if (code !== 0 || exceeded) reject(new RemoteError('command'));
          else resolve(output.trim());
        });
        stream.end(input);
      });
    });
  }
  async upload(local: string, destination: string) {
    if (this.closed) throw new RemoteError('disconnected');
    const sftp = await this.openSftp();
    try {
      await pipeline(
        createReadStream(local),
        sftp.createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
        { signal: AbortSignal.timeout(15 * 60000) },
      );
    } catch {
      throw new RemoteError('transfer');
    } finally {
      sftp.end();
    }
  }
  private openSftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      const failed = () => {
        clearTimeout(timer);
        reject(new RemoteError('transfer'));
      };
      const timer = setTimeout(() => {
        this.close();
        failed();
      }, 15000);
      this.client.once('close', failed);
      this.client.sftp((error, sftp) => {
        clearTimeout(timer);
        this.client.removeListener('close', failed);
        if (error) reject(new RemoteError('transfer'));
        else if (this.closed) {
          sftp.end();
          reject(new RemoteError('transfer'));
        } else resolve(sftp);
      });
    });
  }
  forward(): Promise<ClientChannel> {
    if (this.closed) return Promise.reject(new RemoteError('disconnected'));
    return new Promise((resolve, reject) => {
      this.client.forwardOut('127.0.0.1', 0, '127.0.0.1', 8080, (error, stream) => {
        if (error) reject(new RemoteError('tunnel'));
        else resolve(stream);
      });
    });
  }
  close() {
    this.closed = true;
    this.client.destroy();
  }
}

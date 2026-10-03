import { createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';

/** The address answered, but with an error status: not a reason to try another source. */
export class ReleaseHttpError extends Error {
  constructor(readonly status: number) {
    super(`Release request failed (${String(status)})`);
    this.name = 'ReleaseHttpError';
  }
}

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const metadataLimit = 1024 * 1024;

/**
 * HTTPS requests of the updater with manual redirects. `authorize` decides per hop which
 * credential a host receives, so a redirect to a storage host never carries one. Plain http is
 * accepted only on loopback (a hub under test).
 */
export class ReleaseHttp {
  constructor(
    private readonly authorize: (target: URL) => Record<string, string>,
    private readonly signal?: AbortSignal,
  ) {}

  async response(
    url: string,
    accept: string,
    headers: Record<string, string> = {},
    timeoutMs = 600000,
  ): Promise<Response> {
    let target = new URL(url);
    for (let redirect = 0; redirect < 6; redirect++) {
      const plain = target.protocol === 'http:' && loopback.has(target.hostname);
      if ((target.protocol !== 'https:' && !plain) || target.username || target.password)
        throw new Error('Unsafe release URL');
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch(target, {
        headers: {
          Accept: accept,
          'User-Agent': 'ProAnima-Arkvory-Installer',
          ...(redirect === 0 ? headers : {}),
          ...this.authorize(target),
        },
        redirect: 'manual',
        signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Missing release redirect');
        target = new URL(location, target);
        continue;
      }
      if (!response.ok && response.status !== 204) {
        await response.body?.cancel();
        throw new ReleaseHttpError(response.status);
      }
      return response;
    }
    throw new Error('Too many release redirects');
  }

  /** A small document (manifest, signature, release JSON) as bytes, at most 1 MiB. */
  async bytes(response: Response): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('Empty release response');
    for await (const raw of response.body) {
      const chunk: unknown = raw;
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid HTTP stream');
      size += chunk.length;
      if (size > metadataLimit) throw new Error('Release metadata too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** Streams the archive to a new file and keeps it only when its SHA-256 matches. */
  async download(url: string, destination: string, sha256: string): Promise<void> {
    const file = await open(destination, 'wx', 0o600);
    try {
      const response = await this.response(url, 'application/octet-stream');
      if (!response.body) throw new Error('Empty archive');
      let size = 0;
      const hash = createHash('sha256');
      for await (const raw of response.body) {
        const chunk: unknown = raw;
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid HTTP stream');
        size += chunk.length;
        if (size > 512 * 1024 ** 2) throw new Error('Release archive exceeds limit');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      if (hash.digest('hex') !== sha256) throw new Error('Release checksum mismatch');
      await file.sync();
    } catch (error) {
      await file.close();
      await unlink(destination);
      throw error;
    }
    await file.close();
  }
}

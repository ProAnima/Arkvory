import { createHash } from 'node:crypto';
import { open, readFile, unlink } from 'node:fs/promises';
import { record, parseRelease, version } from './model.js';
import type { Release } from './model.js';

const api = 'https://api.github.com/repos/ProAnima/Depot';
export interface ReleaseAssets {
  release: Release;
  archiveUrl: string;
}
export class GitHubReleases {
  constructor(private readonly token: string) {
    if (!/^[A-Za-z0-9_-]{0,512}$/.test(token)) throw new Error('Invalid GitHub token file');
  }
  static async fromTokenFile(path: string): Promise<GitHubReleases> {
    const token = await readFile(path, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw new Error('Cannot read GitHub token file');
    });
    return new GitHubReleases(token.trim());
  }
  private async response(url: string, accept: string): Promise<Response> {
    let target = new URL(url);
    for (let redirect = 0; redirect < 6; redirect++) {
      if (target.protocol !== 'https:' || target.username || target.password)
        throw new Error('Unsafe release URL');
      const headers: Record<string, string> = {
        Accept: accept,
        'User-Agent': 'ProAnima-Depot-Installer',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      // Private asset redirects must never forward the GitHub credential to a storage host.
      if (target.origin === 'https://api.github.com' && this.token)
        headers['Authorization'] = `Bearer ${this.token}`;
      const response = await fetch(target, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(600000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('Missing asset redirect');
        target = new URL(location, target);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`GitHub request failed (${String(response.status)})`);
      }
      return response;
    }
    throw new Error('Too many release redirects');
  }
  private async json(url: string, asset = false): Promise<unknown> {
    const response = await this.response(
      url,
      asset ? 'application/octet-stream' : 'application/vnd.github+json',
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('Empty release response');
    for await (const raw of response.body) {
      const chunk: unknown = raw;
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid HTTP stream');
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Release metadata too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
  async resolve(pin: string | null): Promise<ReleaseAssets> {
    const data = record(
      await this.json(`${api}/releases/${pin === null ? 'latest' : `tags/v${version(pin)}`}`),
    );
    if (data['draft'] !== false || data['prerelease'] !== false || !Array.isArray(data['assets']))
      throw new Error('Release is not stable and published');
    const assets: unknown[] = data['assets'];
    const asset = (name: string): string => {
      const match = assets.map(record).find((item) => item['name'] === name);
      if (
        !match ||
        typeof match['url'] !== 'string' ||
        !match['url'].startsWith(`${api}/releases/assets/`)
      )
        throw new Error(`Missing release asset: ${name}`);
      return match['url'];
    };
    const release = parseRelease(await this.json(asset('depot-release.json'), true));
    if (data['tag_name'] !== `v${release.version}` || (pin !== null && pin !== release.version))
      throw new Error('Release tag mismatch');
    return { release, archiveUrl: asset('depot-runtime.zip') };
  }
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

import { readFile } from 'node:fs/promises';
import { record, parseRelease, version } from './model.js';
import type { Release } from './model.js';
import { ReleaseHttp } from './release-http.js';
import { releaseKeys } from './release-keys.js';
import { verifyReleaseSignature } from './release-signature.js';
import type { ReleaseKey } from './release-signature.js';

const api = 'https://api.github.com/repos/ProAnima/Arkvory';
export interface ReleaseAssets {
  release: Release;
  archiveUrl: string;
}
/** Where a release comes from over the network: the hub (ADR 0060) or GitHub directly. */
export interface ReleaseSource {
  /** The release to install; null when nothing newer than `current` is offered. */
  resolve(pin: string | null, current: Release | null): Promise<ReleaseAssets | null>;
  download(url: string, destination: string, sha256: string): Promise<void>;
}
export class GitHubReleases implements ReleaseSource {
  private readonly http: ReleaseHttp;
  constructor(
    token: string,
    signal?: AbortSignal,
    private readonly keys: readonly ReleaseKey[] = releaseKeys,
  ) {
    if (!/^[A-Za-z0-9_-]{0,512}$/.test(token)) throw new Error('Invalid GitHub token file');
    // Private asset redirects must never forward the GitHub credential to a storage host.
    this.http = new ReleaseHttp(
      (target): Record<string, string> =>
        target.origin === 'https://api.github.com' && token
          ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
          : {},
      signal,
    );
  }
  static async fromTokenFile(path: string, signal?: AbortSignal): Promise<GitHubReleases> {
    const token = await readFile(path, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw new Error('Cannot read GitHub token file');
    });
    return new GitHubReleases(token.trim(), signal);
  }
  private async json(url: string, asset = false): Promise<unknown> {
    return JSON.parse((await this.raw(url, asset)).toString('utf8')) as unknown;
  }
  private async raw(url: string, asset = true): Promise<Buffer> {
    const accept = asset ? 'application/octet-stream' : 'application/vnd.github+json';
    return this.http.bytes(await this.http.response(url, accept));
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
    const manifest = await this.raw(asset('arkvory-release.json'));
    const signature = (await this.raw(asset('arkvory-release.json.sig'))).toString('utf8');
    verifyReleaseSignature(manifest, signature, this.keys);
    const release = parseRelease(JSON.parse(manifest.toString('utf8')));
    if (data['tag_name'] !== `v${release.version}` || (pin !== null && pin !== release.version))
      throw new Error('Release tag mismatch');
    return { release, archiveUrl: asset('arkvory-runtime.zip') };
  }
  download(url: string, destination: string, sha256: string): Promise<void> {
    return this.http.download(url, destination, sha256);
  }
  async native(platform: 'linux' | 'windows', name: string) {
    if (!['Arkvory-amd64.deb', 'Arkvory-x86_64.rpm', 'Arkvory-Setup-x64.exe'].includes(name))
      throw new Error('Invalid native installer');
    const data = record(await this.json(`${api}/releases/latest`));
    if (data['draft'] !== false || data['prerelease'] !== false || !Array.isArray(data['assets']))
      throw new Error('Stable published release required');
    const assets: unknown[] = data['assets'];
    const asset = (file: string) => {
      const matches = assets.map(record).filter((item) => item['name'] === file);
      const url = matches[0]?.['url'];
      if (
        matches.length !== 1 ||
        typeof url !== 'string' ||
        !url.startsWith(`${api}/releases/assets/`)
      )
        throw new Error('Missing release asset');
      return url;
    };
    const manifest = record(
      await this.json(asset(`native-${platform === 'windows' ? 'win32' : 'linux'}.json`), true),
    );
    const files = record(manifest['files']),
      hash = files[name];
    const selected = version(String(manifest['version']));
    if (
      data['tag_name'] !== `v${selected}` ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      typeof manifest['commit'] !== 'string' ||
      !/^[a-f0-9]{40}$/.test(manifest['commit'])
    )
      throw new Error('Native release identity mismatch');
    return { version: selected, hash, url: asset(name) };
  }
}

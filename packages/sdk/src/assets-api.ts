import {
  readAsset,
  readAssetPage,
  readAssetRevision,
  readAssetHistory,
} from '@proanima/depot-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';

export class AssetsApi {
  constructor(private readonly http: HttpPort) {}
  async setAsset(repository: string, path: string, artifactId: string, expectedRevision: number) {
    return readAsset(
      await this.http.call(repositoryPath(repository, 'asset'), 'PUT', {
        path,
        artifactId,
        expectedRevision,
      }),
    );
  }
  async asset(repository: string, path: string) {
    return readAsset(
      await this.http.call(repositoryPath(repository, `asset?path=${encodeURIComponent(path)}`)),
    );
  }
  async assetPage(
    repository: string,
    options: { prefix?: string; after?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams();
    if (options.prefix !== undefined) query.set('prefix', options.prefix);
    if (options.after !== undefined) query.set('after', options.after);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return readAssetPage(
      await this.http.call(
        repositoryPath(repository, `assets/page?${query}`),
        'GET',
        undefined,
        signal,
      ),
      options.limit ?? 50,
    );
  }
  async assetHistory(repository: string, path: string, before?: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ path });
    if (before !== undefined) query.set('before', String(before));
    return readAssetHistory(
      await this.http.call(
        repositoryPath(repository, `asset/history?${query.toString()}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async assetRevision(repository: string, path: string, revision: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ path, revision: String(revision) });
    return readAssetRevision(
      await this.http.call(
        repositoryPath(repository, `asset/revision?${query.toString()}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async restoreAsset(
    repository: string,
    path: string,
    sourceRevision: number,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return readAsset(
      await this.http.call(
        repositoryPath(repository, 'asset/restore'),
        'POST',
        { path, sourceRevision, expectedRevision },
        signal,
      ),
    );
  }
}

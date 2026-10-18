import { readArtifactTree } from '@proanima/arkvory-contracts';
import type { ArtifactTree } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import { ArkvoryClientError } from './transfer.js';

/** Paging of the table of contents of an archive artifact. */
export interface ArtifactTreeQuery {
  /** The `next` cursor of the previous page. */
  readonly after?: string;
  /** 1 to 1000 entries; the server's default is 1000. */
  readonly limit?: number;
}

/** The table of contents of archive artifacts (ADR 0083, N8, stage T2). */
export class TreeApi {
  constructor(private readonly http: HttpPort) {}
  /**
   * One page of the file entries of an archive artifact with their size, SHA-256 and data range
   * in the archive. `status` is `ready`, `pending` (not built yet) or `unavailable` (`reason`);
   * a server without the route answers 404 `route_not_found`.
   */
  async artifactTree(
    repository: string,
    id: string,
    query: ArtifactTreeQuery = {},
    signal?: AbortSignal,
  ): Promise<ArtifactTree> {
    const params = new URLSearchParams();
    if (query.after !== undefined) {
      if (!/^(0|[1-9][0-9]{0,8})$/.test(query.after))
        throw new ArkvoryClientError('invalid_argument', 'Invalid cursor');
      params.set('after', query.after);
    }
    if (query.limit !== undefined) {
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)
        throw new ArkvoryClientError('invalid_argument', 'Invalid page size');
      params.set('limit', String(query.limit));
    }
    const suffix = params.size === 0 ? '' : `?${params.toString()}`;
    const value = await this.http.call(
      repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/tree${suffix}`),
      'GET',
      undefined,
      signal,
    );
    try {
      return readArtifactTree(value);
    } catch {
      throw new ArkvoryClientError('invalid_response', 'Invalid table of contents');
    }
  }
}

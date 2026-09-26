import {
  readAttachmentRevision,
  readAttachmentHistory,
  readUpload,
  readAnnotations,
  record,
  text,
  items,
  readPackageList,
} from '@proanima/arkvory-contracts';
import type { BuildAttachmentResponse, AnnotationsResponse } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';

export class CatalogApi {
  constructor(private readonly http: HttpPort) {}
  async packages(
    repository: string,
    query: {
      group?: string;
      name?: string;
      sort?: 'group' | 'name' | 'version';
      direction?: 'asc' | 'desc';
      groupBy?: 'none' | 'group' | 'package';
      after?: string;
      limit?: number;
    } = {},
  ) {
    const params = new URLSearchParams();
    for (const key of ['group', 'name', 'sort', 'direction', 'groupBy', 'after'] as const) {
      const value = query[key];
      if (value !== undefined) params.set(key, value);
    }
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    // A page contains up to 100 validated 64 KiB manifests plus bounded identity/group fields.
    return readPackageList(
      await this.http.json(
        await this.http.request(repositoryPath(repository, `packages?${params.toString()}`)),
        undefined,
        8 * 1024 ** 2,
      ),
    );
  }
  async artifact(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.http.call(
        repositoryPath(repository, `artifacts/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async list(repository: string, after?: string) {
    // Up to 100 descriptors: 32 metadata values × 1024 UTF-16 code units each.
    // JSON escaping can use six bytes per code unit; retain room for keys/labels/envelope.
    // This limit follows the domain shape, not an HTTP request-size limit at one ingress.
    const r = record(
      await this.http.json(
        await this.http.request(
          repositoryPath(
            repository,
            `artifacts${after ? '?after=' + encodeURIComponent(after) : ''}`,
          ),
        ),
        undefined,
        24 * 1024 ** 2,
      ),
    );
    return {
      items: items(r['items']).map(readUpload),
      next: r['next'] === null ? null : text(r['next']),
    };
  }
  async search(
    repository: string,
    query: { q?: string; label?: string; collection?: string; after?: string } = {},
  ) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) q.set(key, value);
    const r = record(await this.http.call(repositoryPath(repository, `search?${q.toString()}`)));
    return {
      items: items(r['items']).map((value) => {
        const i = record(value);
        return { id: text(i['id']), name: text(i['name']) };
      }),
      next: r['next'] === null ? null : text(r['next']),
    };
  }
  async attachments(repository: string, id: string, signal?: AbortSignal) {
    return readAttachmentRevision(
      await this.http.call(
        repositoryPath(repository, 'artifacts/' + encodeURIComponent(id) + '/attachments'),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async replaceAttachments(
    repository: string,
    id: string,
    expectedRevision: number,
    items: readonly BuildAttachmentResponse[],
    signal?: AbortSignal,
  ) {
    return readAttachmentRevision(
      await this.http.call(
        repositoryPath(repository, 'artifacts/' + encodeURIComponent(id) + '/attachments'),
        'PUT',
        { expectedRevision, items },
        signal,
      ),
    );
  }
  async attachmentHistory(repository: string, id: string, before?: number, signal?: AbortSignal) {
    const query = before === undefined ? '' : '?before=' + encodeURIComponent(before);
    return readAttachmentHistory(
      await this.http.call(
        repositoryPath(repository, 'artifacts/' + encodeURIComponent(id) + '/attachments/history') +
          query,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async annotations(repository: string, id: string) {
    return readAnnotations(
      await this.http.call(
        repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/annotations`),
      ),
    );
  }
  async annotate(
    repository: string,
    id: string,
    expectedRevision: number,
    value: Omit<AnnotationsResponse, 'revision'>,
  ) {
    return readAnnotations(
      await this.http.call(
        repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/annotations`),
        'PUT',
        { expectedRevision, value },
      ),
    );
  }
  async registerPackage(repository: string, id: string) {
    return record(
      await this.http.call(
        repositoryPath(repository, `artifacts/${encodeURIComponent(id)}/package`),
        'POST',
      ),
    );
  }
}

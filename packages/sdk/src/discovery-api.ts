import {
  readRepositoryCard,
  readRepositoryPage,
  record,
  text,
  integer,
  items,
  readOperationPage,
} from '@proanima/arkvory-contracts';
import type { OperationQuery } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

export class DiscoveryApi {
  constructor(private readonly http: HttpPort) {}
  async operations(query: OperationQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    for (const key of ['repository', 'surface', 'after'] as const) {
      const value = query[key];
      if (value !== undefined) params.set(key, value);
    }
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return readOperationPage(
      await this.http.call(`api/v1/operations?${params.toString()}`, 'GET', undefined, signal),
    );
  }
  async capabilities(signal?: AbortSignal) {
    const r = record(await this.http.call('api/v1/capabilities', 'GET', undefined, signal));
    const gatewayRole = r['gatewayRole'];
    if (gatewayRole !== 'api' && gatewayRole !== 'reader') throw new Error('Invalid gateway role');
    const features = Object.fromEntries(
      Object.entries(record(r['features'])).map(([key, value]) => {
        if (typeof value !== 'boolean') throw new Error('Invalid capability');
        return [key, value] as const;
      }),
    );
    const limits = record(r['limits']);
    return {
      apiVersions: items(r['apiVersions']).map(text),
      gatewayRole,
      features,
      limits: {
        maxObjectBytes: text(limits['maxObjectBytes']),
        partBytes: integer(limits['partBytes']),
        maxPageSize: integer(limits['maxPageSize']),
      },
    };
  }
  async repositories(options: { after?: string; limit?: number } = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (options.after !== undefined) query.set('after', options.after);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return readRepositoryPage(
      await this.http.call(`api/v1/repositories?${query}`, 'GET', undefined, signal),
      options.limit ?? 50,
    );
  }
  async repository(id: string, signal?: AbortSignal) {
    return readRepositoryCard(
      await this.http.call(
        `api/v1/repositories/${encodeURIComponent(id)}`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
}

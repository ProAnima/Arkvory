import { ArkvoryClientError } from './transfer.js';
import { readUpdateSnapshot, readUpdateRequest, record, text } from '@proanima/arkvory-contracts';
import type { UpdateRequest } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

export class UpdatesApi {
  constructor(private readonly http: HttpPort) {}
  async status(signal?: AbortSignal) {
    const r = record(await this.http.call('/api/v1/system/updates', 'GET', undefined, signal));
    return {
      snapshot: r['snapshot'] === null ? null : readUpdateSnapshot(r['snapshot']),
      pending: r['pending'] === null ? null : readUpdateRequest(r['pending']),
    };
  }
  async request(request: UpdateRequest, signal?: AbortSignal) {
    const r = record(
      await this.http.call(
        '/api/v1/system/updates/requests',
        'POST',
        readUpdateRequest(request),
        signal,
      ),
    );
    if (text(r['id']) !== request.id)
      throw new ArkvoryClientError('invalid_response', 'Update receipt mismatch');
    return { id: request.id };
  }
}

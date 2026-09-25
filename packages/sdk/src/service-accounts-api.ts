import {
  record,
  text,
  items,
  readServiceAccount,
  readApiKey,
  readServicePage,
} from '@proanima/depot-contracts';
import type { ServiceBindingResponse } from '@proanima/depot-contracts';
import type { HttpPort } from './http-transport.js';

export class ServiceAccountsApi {
  constructor(private readonly http: HttpPort) {}
  async serviceAccounts(after?: string, signal?: AbortSignal) {
    return readServicePage(
      await this.http.call(
        `api/v1/service-accounts${after === undefined ? '' : '?after=' + encodeURIComponent(after)}`,
        'GET',
        undefined,
        signal,
      ),
      readServiceAccount,
    );
  }
  async servicePolicy(accountId: string, signal?: AbortSignal) {
    return readServiceAccount(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(accountId)}/policy`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async serviceAccount(id: string, signal?: AbortSignal) {
    return readServiceAccount(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async createServiceAccount(
    name: string,
    bindings: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ) {
    return readServiceAccount(
      await this.http.call('api/v1/service-accounts', 'POST', { name, bindings }, signal),
    );
  }
  async updateServiceAccount(
    id: string,
    expectedRevision: number,
    enabled: boolean,
    signal?: AbortSignal,
  ) {
    return readServiceAccount(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}`,
        'PATCH',
        { expectedRevision, enabled },
        signal,
      ),
    );
  }
  async setServicePolicy(
    id: string,
    expectedRevision: number,
    bindings: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ) {
    return readServiceAccount(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}/policy`,
        'PUT',
        { expectedRevision, bindings },
        signal,
      ),
    );
  }
  async serviceKeys(id: string, after?: string, signal?: AbortSignal) {
    return readServicePage(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}/keys${after === undefined ? '' : '?after=' + encodeURIComponent(after)}`,
        'GET',
        undefined,
        signal,
      ),
      readApiKey,
    );
  }
  async serviceAudit(id: string, after = '0', signal?: AbortSignal) {
    const result = record(
      await this.http.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}/audit?after=${encodeURIComponent(after)}`,
        'GET',
        undefined,
        signal,
      ),
    );
    return items(result['items']).map((entry) => {
      const r = record(entry);
      return {
        sequence: text(r['sequence']),
        actor: text(r['actor']),
        action: text(r['action']),
        accountId: text(r['accountId']),
        keyId: r['keyId'] === null ? null : text(r['keyId']),
        occurredAt: text(r['occurredAt']),
      };
    });
  }
}

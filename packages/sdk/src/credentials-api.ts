import {
  readApiKey,
  readKeyIssue,
  readDelegation,
  readDelegations,
} from '@proanima/depot-contracts';
import type { ServiceBindingResponse, AdministrationPermission } from '@proanima/depot-contracts';
import type { HttpPort } from './http-transport.js';

export class CredentialsApi {
  constructor(private readonly http: HttpPort) {}
  async serviceDelegations(keyId: string, signal?: AbortSignal) {
    return readDelegations(
      await this.http.call(
        `api/v1/api-keys/${encodeURIComponent(keyId)}/delegations`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async setServiceDelegation(
    keyId: string,
    accountId: string,
    expectedRevision: number,
    actions: readonly AdministrationPermission[],
    ceiling: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ) {
    return readDelegation(
      await this.http.call(
        `api/v1/api-keys/${encodeURIComponent(keyId)}/delegations/${encodeURIComponent(accountId)}`,
        'PUT',
        { expectedRevision, actions, ceiling },
        signal,
      ),
    );
  }
  async removeServiceDelegation(
    keyId: string,
    accountId: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return readDelegation(
      await this.http.call(
        `api/v1/api-keys/${encodeURIComponent(keyId)}/delegations/${encodeURIComponent(accountId)}`,
        'DELETE',
        { expectedRevision },
        signal,
      ),
    );
  }
  async serviceKey(id: string, signal?: AbortSignal) {
    return readApiKey(
      await this.http.call(`api/v1/api-keys/${encodeURIComponent(id)}`, 'GET', undefined, signal),
    );
  }
  private async issueServiceCredential(
    path: string,
    idempotencyKey: string,
    options: { name: string; bindings: readonly ServiceBindingResponse[]; expiresAt?: string },
    signal?: AbortSignal,
  ) {
    return readKeyIssue(
      await this.http.json(
        await this.http.request(
          path,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(options),
          },
          signal,
        ),
        signal,
      ),
    );
  }
  async issueServiceKey(
    id: string,
    idempotencyKey: string,
    options: { name: string; bindings: readonly ServiceBindingResponse[]; expiresAt?: string },
    signal?: AbortSignal,
  ) {
    return this.issueServiceCredential(
      `api/v1/service-accounts/${encodeURIComponent(id)}/keys`,
      idempotencyKey,
      options,
      signal,
    );
  }
  async rotateServiceKey(
    id: string,
    idempotencyKey: string,
    options: { name: string; bindings: readonly ServiceBindingResponse[]; expiresAt?: string },
    signal?: AbortSignal,
  ) {
    return this.issueServiceCredential(
      `api/v1/api-keys/${encodeURIComponent(id)}/rotate`,
      idempotencyKey,
      options,
      signal,
    );
  }
  async revokeServiceKey(id: string, signal?: AbortSignal) {
    await this.http.request(
      `api/v1/api-keys/${encodeURIComponent(id)}/revoke`,
      { method: 'POST' },
      signal,
    );
  }
}

import {
  readUpload,
  readAnnotations,
  readJob,
  readAsset,
  readAssetRevision,
  readAssetHistory,
  record,
  text,
  integer,
  items,
  readAccount,
  readGroup,
  readLogin,
  readPrincipal,
  readPackageList,
  readServiceAccount,
  readApiKey,
  readKeyIssue,
  readServicePage,
  readServiceBindings,
  readDelegation,
  readDelegations,
} from '@proanima/depot-contracts';
import type {
  UploadResponse,
  AnnotationsResponse,
  ServiceBindingResponse,
  AdministrationPermission,
} from '@proanima/depot-contracts';
import {
  DepotHttpError,
  DepotNetworkError,
  TransferAttempts,
  transferPolicy,
  retryAfter,
  readNetwork,
  releaseReader,
} from './transfer.js';
import type { TransferPolicy, TransferOptions } from './transfer.js';
import { verifiedDownload } from './verified-download.js';

export class DepotClient {
  private readonly base: URL;
  private readonly policy: ReturnType<typeof transferPolicy>;
  constructor(
    baseUrl: string,
    private readonly token: () => string,
    policy: TransferPolicy = {},
  ) {
    this.policy = transferPolicy(policy);
    this.base = new URL(baseUrl);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !(
        this.base.protocol === 'https:' ||
        (this.base.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname))
      )
    )
      throw new Error('Use HTTPS (HTTP is allowed only on loopback)');
  }
  private path(repository: string, suffix: string) {
    return `api/v1/repositories/${encodeURIComponent(repository)}/${suffix}`;
  }
  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token()}`);
    const response = await fetch(
      new URL(path, this.base.href.endsWith('/') ? this.base : new URL(this.base.href + '/')),
      {
        ...init,
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    ).catch(() => {
      signal?.throwIfAborted();
      throw new DepotNetworkError();
    });
    if (!response.ok) {
      let code = 'http_error',
        requestId = '';
      try {
        const value = record(await this.json(response, signal));
        code = text(value['code']);
        requestId = text(value['requestId']);
      } catch {
        /* Non-JSON proxies are reported without reflecting their response. */
      }
      signal?.throwIfAborted();
      throw new DepotHttpError(
        response.status,
        code,
        requestId,
        retryAfter(response.headers.get('retry-after')),
      );
    }
    return response;
  }
  private async json(
    response: Response,
    signal?: AbortSignal,
    maxBytes = 2 * 1024 ** 2,
  ): Promise<unknown> {
    if (!response.body) throw new Error('Missing response body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await readNetwork(reader, signal);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > maxBytes) throw new Error('Response exceeds SDK limit');
        chunks.push(result.value);
      }
    } finally {
      await releaseReader(reader);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    return value;
  }
  private async call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    return this.json(
      await this.request(
        path,
        {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        },
        signal,
      ),
      signal,
    );
  }
  async login(name: string, password: string) {
    return readLogin(await this.call('api/v1/auth/login', 'POST', { name, password }));
  }
  async capabilities(signal?: AbortSignal) {
    const r = record(await this.call('api/v1/capabilities', 'GET', undefined, signal));
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
  async permissions(signal?: AbortSignal) {
    const r = record(
      await this.json(
        await this.request('api/v1/auth/permissions', {}, signal),
        signal,
        8 * 1024 ** 2,
      ),
    );
    const profile = r['profile'];
    if (
      (profile !== 'legacy' && profile !== 'managed') ||
      typeof r['serviceAdministration'] !== 'boolean'
    )
      throw new Error('Invalid permission profile');
    return {
      id: text(r['id']),
      profile,
      bindings: readServiceBindings(r['bindings'], 10000),
      serviceAdministration: r['serviceAdministration'],
      credentialId:
        r['credentialId'] === undefined || r['credentialId'] === null
          ? null
          : text(r['credentialId']),
    };
  }
  async serviceAccounts(after?: string, signal?: AbortSignal) {
    return readServicePage(
      await this.call(
        `api/v1/service-accounts${after === undefined ? '' : '?after=' + encodeURIComponent(after)}`,
        'GET',
        undefined,
        signal,
      ),
      readServiceAccount,
    );
  }
  async serviceDelegations(keyId: string, signal?: AbortSignal) {
    return readDelegations(
      await this.call(
        `api/v1/api-keys/${encodeURIComponent(keyId)}/delegations`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async servicePolicy(accountId: string, signal?: AbortSignal) {
    return readServiceAccount(
      await this.call(
        `api/v1/service-accounts/${encodeURIComponent(accountId)}/policy`,
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
      await this.call(
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
      await this.call(
        `api/v1/api-keys/${encodeURIComponent(keyId)}/delegations/${encodeURIComponent(accountId)}`,
        'DELETE',
        { expectedRevision },
        signal,
      ),
    );
  }
  async serviceAccount(id: string, signal?: AbortSignal) {
    return readServiceAccount(
      await this.call(
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
      await this.call('api/v1/service-accounts', 'POST', { name, bindings }, signal),
    );
  }
  async updateServiceAccount(
    id: string,
    expectedRevision: number,
    enabled: boolean,
    signal?: AbortSignal,
  ) {
    return readServiceAccount(
      await this.call(
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
      await this.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}/policy`,
        'PUT',
        { expectedRevision, bindings },
        signal,
      ),
    );
  }
  async serviceKeys(id: string, after?: string, signal?: AbortSignal) {
    return readServicePage(
      await this.call(
        `api/v1/service-accounts/${encodeURIComponent(id)}/keys${after === undefined ? '' : '?after=' + encodeURIComponent(after)}`,
        'GET',
        undefined,
        signal,
      ),
      readApiKey,
    );
  }
  async serviceKey(id: string, signal?: AbortSignal) {
    return readApiKey(
      await this.call(`api/v1/api-keys/${encodeURIComponent(id)}`, 'GET', undefined, signal),
    );
  }
  private async issueServiceCredential(
    path: string,
    idempotencyKey: string,
    options: { name: string; bindings: readonly ServiceBindingResponse[]; expiresAt?: string },
    signal?: AbortSignal,
  ) {
    return readKeyIssue(
      await this.json(
        await this.request(
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
    await this.request(
      `api/v1/api-keys/${encodeURIComponent(id)}/revoke`,
      { method: 'POST' },
      signal,
    );
  }
  async activateServiceKey(signal?: AbortSignal) {
    await this.request('api/v1/auth/activate-key', { method: 'POST' }, signal);
  }
  async serviceAudit(id: string, after = '0', signal?: AbortSignal) {
    const result = record(
      await this.call(
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
  async me() {
    return readPrincipal(await this.call('api/v1/auth/me'));
  }
  async logout() {
    await this.request('api/v1/auth/logout', { method: 'POST' });
  }
  async changePassword(currentPassword: string, newPassword: string) {
    await this.request('api/v1/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
  async users() {
    const result = record(await this.call('api/v1/users'));
    return items(result['items']).map(readAccount);
  }
  async createUser(name: string, password: string, administrator = false) {
    return readAccount(await this.call('api/v1/users', 'POST', { name, password, administrator }));
  }
  async updateUser(id: string, update: { enabled?: boolean; password?: string }) {
    return readAccount(await this.call(`api/v1/users/${encodeURIComponent(id)}`, 'PATCH', update));
  }
  async accessGroups() {
    const result = record(await this.call('api/v1/access-groups'));
    return items(result['items']).map(readGroup);
  }
  async createAccessGroup(name: string) {
    return readGroup(await this.call('api/v1/access-groups', 'POST', { name }));
  }
  async setGroupMember(groupId: string, userId: string, present: boolean) {
    await this.request(
      `api/v1/access-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      { method: present ? 'PUT' : 'DELETE' },
    );
  }
  async setGroupGrant(groupId: string, repository: string, access: 'read' | 'write' | null) {
    await this.request(
      `api/v1/access-groups/${encodeURIComponent(groupId)}/grants/${encodeURIComponent(repository)}`,
      access === null
        ? { method: 'DELETE' }
        : {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access }),
          },
    );
  }
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
      await this.json(
        await this.request(this.path(repository, `packages?${params.toString()}`)),
        undefined,
        8 * 1024 ** 2,
      ),
    );
  }
  async create(
    repository: string,
    key: string,
    descriptor: UploadResponse['descriptor'],
    signal?: AbortSignal,
  ) {
    return new TransferAttempts(this.policy, signal ? { signal } : {}).run((attemptSignal) =>
      this.createOnce(repository, key, descriptor, attemptSignal),
    );
  }
  private async createOnce(
    repository: string,
    key: string,
    descriptor: UploadResponse['descriptor'],
    signal: AbortSignal,
  ) {
    return readUpload(
      await this.json(
        await this.request(
          this.path(repository, 'uploads'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(descriptor),
          },
          signal,
        ),
        signal,
      ),
    );
  }
  async status(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async artifact(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `artifacts/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async list(repository: string, after?: string) {
    const r = record(
      await this.call(
        this.path(repository, `artifacts${after ? '?after=' + encodeURIComponent(after) : ''}`),
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
    const r = record(await this.call(this.path(repository, `search?${q.toString()}`)));
    return {
      items: items(r['items']).map((value) => {
        const i = record(value);
        return { id: text(i['id']), name: text(i['name']) };
      }),
      next: r['next'] === null ? null : text(r['next']),
    };
  }
  async annotations(repository: string, id: string) {
    return readAnnotations(
      await this.call(this.path(repository, `artifacts/${encodeURIComponent(id)}/annotations`)),
    );
  }
  async annotate(
    repository: string,
    id: string,
    expectedRevision: number,
    value: Omit<AnnotationsResponse, 'revision'>,
  ) {
    return readAnnotations(
      await this.call(
        this.path(repository, `artifacts/${encodeURIComponent(id)}/annotations`),
        'PUT',
        { expectedRevision, value },
      ),
    );
  }
  async parts(repository: string, id: string, signal?: AbortSignal) {
    const r = record(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/parts`),
        'GET',
        undefined,
        signal,
      ),
    );
    return {
      partBytes: integer(r['partBytes']),
      items: items(r['items']).map((value) => {
        const p = record(value);
        return { index: integer(p['index']), size: integer(p['size']), sha256: text(p['sha256']) };
      }),
    };
  }
  async complete(repository: string, id: string, signal?: AbortSignal) {
    return readUpload(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/complete`),
        'POST',
        undefined,
        signal,
      ),
    );
  }
  async enqueue(repository: string, id: string) {
    return readJob(
      await this.call(
        this.path(repository, `uploads/${encodeURIComponent(id)}/complete-async`),
        'POST',
      ),
    );
  }
  async job(id: string) {
    return readJob(await this.call(`api/v1/jobs/${encodeURIComponent(id)}`));
  }
  async registerPackage(repository: string, id: string) {
    return record(
      await this.call(this.path(repository, `artifacts/${encodeURIComponent(id)}/package`), 'POST'),
    );
  }
  async setAsset(repository: string, path: string, artifactId: string, expectedRevision: number) {
    return readAsset(
      await this.call(this.path(repository, 'asset'), 'PUT', {
        path,
        artifactId,
        expectedRevision,
      }),
    );
  }
  async asset(repository: string, path: string) {
    return readAsset(
      await this.call(this.path(repository, `asset?path=${encodeURIComponent(path)}`)),
    );
  }
  async assetHistory(repository: string, path: string, before?: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ path });
    if (before !== undefined) query.set('before', String(before));
    return readAssetHistory(
      await this.call(
        this.path(repository, `asset/history?${query.toString()}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async assetRevision(repository: string, path: string, revision: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ path, revision: String(revision) });
    return readAssetRevision(
      await this.call(
        this.path(repository, `asset/revision?${query.toString()}`),
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
      await this.call(
        this.path(repository, 'asset/restore'),
        'POST',
        { path, sourceRevision, expectedRevision },
        signal,
      ),
    );
  }
  async cancel(repository: string, id: string) {
    return readUpload(
      await this.call(this.path(repository, `uploads/${encodeURIComponent(id)}`), 'DELETE'),
    );
  }
  async download(
    repository: string,
    id: string,
    range?: { start: number; end: number },
    signal?: AbortSignal,
  ) {
    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start)
    )
      throw new Error('Invalid range');
    return this.request(
      this.path(repository, `artifacts/${encodeURIComponent(id)}/content`),
      { headers: range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {} },
      signal,
    );
  }
  async resume(
    repository: string,
    id: string,
    file: Blob,
    options: TransferOptions & { onProgress?: (bytes: number) => void } = {},
  ) {
    const attempts = new TransferAttempts(this.policy, options);
    const upload = await attempts.run((signal) => this.status(repository, id, signal));
    if (Number(upload.descriptor.size) !== file.size)
      throw new Error('File size differs from upload');
    if (upload.status === 'available') return upload;
    if (upload.status !== 'pending') throw new Error('Upload is cancelled');
    if (file.size === 0)
      return attempts.run(async (signal) => {
        // PUT /content is not replayed after publication; reconcile a lost response first.
        const current = await this.status(repository, id, signal);
        if (current.status === 'available') return current;
        return readUpload(
          await this.json(
            await this.request(
              this.path(repository, `uploads/${encodeURIComponent(id)}/content`),
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file,
              },
              signal,
            ),
            signal,
          ),
        );
      });
    const existing = await attempts.run((signal) => this.parts(repository, id, signal));
    if (existing.partBytes !== 8 * 1024 ** 2) throw new Error('Unsupported part size');
    const indices = new Set<number>();
    if (existing.items.length > Math.ceil(file.size / existing.partBytes))
      throw new Error('Invalid server parts');
    for (const part of existing.items) {
      if (
        indices.has(part.index) ||
        part.index >= Math.ceil(file.size / existing.partBytes) ||
        part.size !== Math.min(existing.partBytes, file.size - part.index * existing.partBytes) ||
        !/^[a-f0-9]{64}$/.test(part.sha256)
      )
        throw new Error('Invalid server parts');
      indices.add(part.index);
    }
    for (let offset = 0, index = 0; offset < file.size; offset += existing.partBytes, index++) {
      options.signal?.throwIfAborted();
      const part = file.slice(offset, Math.min(file.size, offset + existing.partBytes));
      const digest = await crypto.subtle.digest('SHA-256', await part.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      const prior = existing.items.find((value) => value.index === index);
      if (prior && prior.sha256 !== sha256)
        throw new Error('Selected file does not match uploaded parts');
      if (!prior)
        await attempts.run(async (signal) => {
          const response = await this.request(
            this.path(repository, `uploads/${encodeURIComponent(id)}/parts/${String(index)}`),
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256 },
              body: part,
            },
            signal,
          );
          await response.body?.cancel();
        });
      options.onProgress?.(Math.min(file.size, offset + existing.partBytes));
    }
    // Assembly may be substantially slower than one bounded part transfer.
    return attempts.run((signal) => this.complete(repository, id, signal), 1_800_000);
  }

  /** A verified suffix stream. Supply an immutable saved prefix to resume after a process restart.
   * Commit the destination only when this stream closes successfully, never after the last write.
   */
  async downloadVerified(
    repository: string,
    id: string,
    options: TransferOptions & { prefix?: Blob } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const attempts = new TransferAttempts(this.policy, { ...options, signal });
    const artifact = await attempts.run((attemptSignal) =>
      this.artifact(repository, id, attemptSignal),
    );
    return verifiedDownload(
      artifact,
      options.prefix,
      attempts,
      signal,
      controller,
      (start, end, attemptSignal) =>
        this.request(
          this.path(repository, `artifacts/${encodeURIComponent(id)}/content`),
          {
            headers: {
              Range: `bytes=${String(start)}-${String(end)}`,
              'If-Range': `"sha256:${artifact.descriptor.sha256}"`,
            },
          },
          attemptSignal,
        ),
    );
  }
}

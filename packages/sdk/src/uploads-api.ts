import { readUpload, readJob, record, text, integer, items } from '@proanima/depot-contracts';
import type { UploadResponse } from '@proanima/depot-contracts';
import { TransferAttempts } from './transfer.js';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';
import type { transferPolicy } from './transfer.js';

export class UploadsApi {
  constructor(
    private readonly http: HttpPort,
    private readonly policy: ReturnType<typeof transferPolicy>,
  ) {}
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
      await this.http.json(
        await this.http.request(
          repositoryPath(repository, 'uploads'),
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
      await this.http.call(
        repositoryPath(repository, `uploads/${encodeURIComponent(id)}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async parts(repository: string, id: string, signal?: AbortSignal) {
    const r = record(
      await this.http.call(
        repositoryPath(repository, `uploads/${encodeURIComponent(id)}/parts`),
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
      await this.http.call(
        repositoryPath(repository, `uploads/${encodeURIComponent(id)}/complete`),
        'POST',
        undefined,
        signal,
      ),
    );
  }
  async enqueue(repository: string, id: string) {
    return readJob(
      await this.http.call(
        repositoryPath(repository, `uploads/${encodeURIComponent(id)}/complete-async`),
        'POST',
      ),
    );
  }
  async job(id: string) {
    return readJob(await this.http.call(`api/v1/jobs/${encodeURIComponent(id)}`));
  }
  async cancel(repository: string, id: string) {
    return readUpload(
      await this.http.call(
        repositoryPath(repository, `uploads/${encodeURIComponent(id)}`),
        'DELETE',
      ),
    );
  }
}

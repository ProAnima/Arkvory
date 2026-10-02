import {
  readBackupJobPage,
  readBackupPlan,
  readBackupPoint,
  readBackupPointPage,
  readBackupReceipt,
  readBackupRetentionPreview,
  readBackupStatus,
} from '@proanima/arkvory-contracts';
import type {
  BackupJobKind,
  BackupJobResponse,
  BackupPageResponse,
  BackupPlanResponse,
  BackupPlanUpdateRequest,
  BackupPointResponse,
  BackupReceiptResponse,
  BackupRetentionPreviewResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';
import { ArkvoryClientError } from './transfer.js';
import type { HttpPort } from './http-transport.js';

export interface BackupPageQuery {
  /** `next` of the previous page. */
  readonly after?: string;
  /** 1-100, default 50. */
  readonly limit?: number;
}

/**
 * Instance backups (ADR 0056): status, plan, jobs and points; requires backup.read, changes
 * require backup.manage. Commands are queued for the server's backup agent: a 202 receipt is
 * a job id to follow in jobs(), not a finished backup. A command repeated with the same key
 * (the default key is new per call) returns the same job, so a lost response is retried safely.
 */
export class BackupApi {
  constructor(private readonly http: HttpPort) {}

  async status(signal?: AbortSignal): Promise<BackupStatusResponse> {
    return readBackupStatus(await this.http.call('api/v1/backup/status', 'GET', undefined, signal));
  }

  async plan(signal?: AbortSignal): Promise<BackupPlanResponse> {
    return readBackupPlan(await this.http.call('api/v1/backup/plan', 'GET', undefined, signal));
  }

  /** 409 conflict/revision_mismatch when the plan changed: read it again and reapply. */
  async updatePlan(body: BackupPlanUpdateRequest, signal?: AbortSignal) {
    return readBackupPlan(await this.http.call('api/v1/backup/plan', 'PUT', body, signal));
  }

  run(key?: string, signal?: AbortSignal): Promise<BackupReceiptResponse> {
    return this.command('api/v1/backup/runs', 'capture', key, signal);
  }

  /** Deep verification: every byte of the point is read and hashed. */
  verify(pointId: string, key?: string, signal?: AbortSignal): Promise<BackupReceiptResponse> {
    return this.command(
      `api/v1/backup/points/${encodeURIComponent(pointId)}/verify`,
      'verify',
      key,
      signal,
    );
  }

  applyRetention(key?: string, signal?: AbortSignal): Promise<BackupReceiptResponse> {
    return this.command('api/v1/backup/retention/apply', 'retention', key, signal);
  }

  async jobs(
    query: BackupPageQuery = {},
    signal?: AbortSignal,
  ): Promise<BackupPageResponse<BackupJobResponse>> {
    return readBackupJobPage(
      await this.http.call(`api/v1/backup/jobs${pageQuery(query)}`, 'GET', undefined, signal),
    );
  }

  async points(
    query: BackupPageQuery = {},
    signal?: AbortSignal,
  ): Promise<BackupPageResponse<BackupPointResponse>> {
    return readBackupPointPage(
      await this.http.call(`api/v1/backup/points${pageQuery(query)}`, 'GET', undefined, signal),
    );
  }

  async pin(pointId: string, pinned: boolean, signal?: AbortSignal) {
    return readBackupPoint(
      await this.http.call(
        `api/v1/backup/points/${encodeURIComponent(pointId)}/pin`,
        'PUT',
        { pinned },
        signal,
      ),
    );
  }

  async retentionPreview(signal?: AbortSignal): Promise<BackupRetentionPreviewResponse> {
    return readBackupRetentionPreview(
      await this.http.call('api/v1/backup/retention/preview', 'GET', undefined, signal),
    );
  }

  private async command(
    path: string,
    kind: BackupJobKind,
    key: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<BackupReceiptResponse> {
    const idempotencyKey = key ?? globalThis.crypto.randomUUID();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))
      throw new ArkvoryClientError('invalid_argument', 'Invalid idempotency key');
    const receipt = readBackupReceipt(
      await this.http.json(
        await this.http.request(
          path,
          { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
          signal,
        ),
        signal,
      ),
    );
    if (receipt.kind !== kind)
      throw new ArkvoryClientError('invalid_response', 'Backup receipt kind mismatch');
    return receipt;
  }
}

function pageQuery(query: BackupPageQuery): string {
  const params = new URLSearchParams();
  if (query.after !== undefined) params.set('after', query.after);
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
      throw new ArkvoryClientError('invalid_argument', 'Invalid page limit');
    params.set('limit', String(query.limit));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

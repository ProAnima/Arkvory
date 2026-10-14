import {
  readSiteChange,
  readSiteChangeStatus,
  record,
  siteChangeKinds,
  text,
} from '@proanima/arkvory-contracts';
import type {
  SiteChange,
  SiteChangeError,
  SiteChangeKind,
  SiteChangeRecord,
} from '@proanima/arkvory-contracts';
import { ArkvoryClientError } from './transfer.js';
import type { HttpPort } from './http-transport.js';

export interface SiteChanges {
  /** Whether the site's agent reports in; without it nothing queued is applied. */
  readonly agent: boolean;
  /** The site installs an update: changes wait until it is done. */
  readonly updating: boolean;
  /** A change was interrupted half done: none is taken until `arkvory changes-reset` there. */
  readonly blocked: SiteChangeError | null;
  readonly pending: {
    readonly id: string;
    readonly kind: SiteChangeKind;
    readonly actor: string;
    readonly requestedAt: string;
  } | null;
  readonly recent: readonly SiteChangeRecord[];
}

function kindOf(value: unknown): SiteChangeKind {
  const kind = siteChangeKinds.find((item) => item === value);
  if (!kind) throw new ArkvoryClientError('invalid_response', 'Unknown change kind');
  return kind;
}

/**
 * Mirrors and HA through the site's agent (ADR 0077, stage F3): global administrators. A request
 * is queued, not applied; follow it in `status()` by its id. `key` is the source key of a mirror,
 * sent once and never returned.
 */
export class SiteChangesApi {
  constructor(private readonly http: HttpPort) {}
  async status(signal?: AbortSignal): Promise<SiteChanges> {
    const row = record(await this.http.call('/api/v1/system/changes', 'GET', undefined, signal));
    const pending = row['pending'] === null ? null : record(row['pending']);
    const { recent, blocked } = readSiteChangeStatus({
      heartbeatAt: new Date(0).toISOString(),
      blocked: row['blocked'] ?? null,
      recent: row['recent'],
    });
    if (typeof row['agent'] !== 'boolean')
      throw new ArkvoryClientError('invalid_response', 'Invalid change status');
    return {
      agent: row['agent'],
      // Older sites do not report it: no update is known then.
      updating: row['updating'] === true,
      blocked,
      pending: pending && {
        id: text(pending['id']),
        kind: kindOf(pending['kind']),
        actor: text(pending['actor']),
        requestedAt: text(pending['requestedAt']),
      },
      recent,
    };
  }
  async request(
    request: { readonly id: string; readonly change: SiteChange; readonly key?: string },
    signal?: AbortSignal,
  ) {
    const change = readSiteChange(request.change);
    const row = record(
      await this.http.call(
        '/api/v1/system/changes',
        'POST',
        { id: request.id, change, ...(request.key === undefined ? {} : { key: request.key }) },
        signal,
      ),
    );
    if (text(row['id']) !== request.id)
      throw new ArkvoryClientError('invalid_response', 'Change receipt mismatch');
    return { id: request.id };
  }
}

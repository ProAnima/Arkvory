import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  isSourceKey,
  readSiteChangeRequest,
  readSiteChangeStatus,
  readUpdateSnapshot,
  SITE_CHANGE_ACTOR_LENGTH,
} from '@proanima/arkvory-contracts';
import type { SiteChange, SiteChangeRequest } from '@proanima/arkvory-contracts';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { mailboxJson, publish } from './mailbox-files.js';

/** Twenty records, compact: far below this even with every field at its longest. */
const STATUS_LIMIT = 65536;
const REQUEST_LIMIT = 16384;
/** The agent writes its status every minute; five missed ticks mean it is not there. */
const STALE_MS = 5 * 60000;

const needsKey = (change: SiteChange) =>
  change.kind === 'mirror-attach' || change.kind === 'mirror-key';
/**
 * The change and its key as one digest: the same id with another change or another key is
 * another request, refused instead of silently keeping the first.
 */
const digestOf = (change: SiteChange, key: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(change))
    .update(typeof key === 'string' ? `\n${createHash('sha256').update(key).digest('hex')}` : '')
    .digest('hex');
/** At most `limit` UTF-16 units, never half of a surrogate pair. */
function cut(text: string, limit: number) {
  if (text.length <= limit) return text;
  const end = /[\ud800-\udbff]/.test(text.charAt(limit - 1)) ? limit - 1 : limit;
  return text.slice(0, end);
}

/**
 * Site changes for the privileged agent (ADR 0077, stage F3) in the updater mailbox of ADR 0038:
 * one request slot, its id and digest remembered by the agent. A source key goes in a 0600 file
 * named after its request and never into the request, the status or a response.
 */
export class SiteChangeControl {
  /** Requests of this process one after another; other processes meet at the slot itself. */
  private turn: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly directory?: string,
    private readonly now: () => number = Date.now,
  ) {}

  async status() {
    if (!this.directory)
      return { agent: false, updating: false, blocked: null, pending: null, recent: [] };
    const directory = this.directory;
    // Anyone who can write the inbox can put anything there: what does not read is no request
    // (the slot still refuses a second one), never a failed status page.
    const quietly = async <T>(path: string, limit: number, read: (value: unknown) => T) => {
      try {
        const value = await mailboxJson(join(directory, path), limit);
        return value === null ? null : read(value);
      } catch {
        return undefined;
      }
    };
    const read = await quietly('status/changes.json', STATUS_LIMIT, readSiteChangeStatus);
    const request = await quietly('inbox/change.json', REQUEST_LIMIT, readSiteChangeRequest);
    const update = await quietly('status/snapshot.json', 16384, readUpdateSnapshot);
    const fresh = (at: string) => this.now() - Date.parse(at) <= STALE_MS;
    return {
      agent: read !== null && read !== undefined && fresh(read.heartbeatAt),
      // The agent installs an update in the same tick: changes wait meanwhile.
      // An image pull or a migration writes no heartbeat for a while: the phase is what counts,
      // within the six hours an update may take at most.
      updating:
        update !== null &&
        update !== undefined &&
        update.phase === 'updating' &&
        this.now() - Date.parse(update.heartbeatAt) <= 6 * 3600000,
      // A status this release cannot read is a barrier too, as the agent treats it.
      blocked: read === undefined ? ('unreadable' as const) : (read?.blocked ?? null),
      pending:
        request === undefined
          ? null
          : request && {
              id: request.id,
              digest: request.digest,
              kind: request.change.kind,
              actor: request.actor,
              requestedAt: request.requestedAt,
            },
      recent: read?.recent ?? [],
    };
  }

  request(id: string, change: SiteChange, key: unknown, actor: string) {
    const next = this.turn.then(() => this.queue(id, change, key, actor));
    this.turn = next.catch(() => undefined);
    return next;
  }

  private async queue(id: string, change: SiteChange, key: unknown, actor: string) {
    const digest = digestOf(change, key);
    const status = await this.status();
    const known = [status.pending, ...status.recent].find((item) => item?.id === id);
    if (known) {
      if (known.digest === digest) return { id };
      throw new ArkvoryError('conflict', 'This id was used for another change', {
        reason: 'idempotency_mismatch',
      });
    }
    if (!this.directory) throw new ArkvoryError('unavailable', 'The site agent is not connected');
    if (status.updating)
      throw new ArkvoryError('busy', 'The site is installing an update; retry afterwards', {
        retryAfterSeconds: 60,
      });
    if (!status.agent)
      throw new ArkvoryError('unavailable', 'The site agent is not connected or not running');
    if (status.blocked)
      throw new ArkvoryError(
        'conflict',
        'A change was interrupted on the site: check it and run arkvory changes-reset there',
        { reason: 'state_conflict' },
      );
    if (status.pending) throw new ArkvoryError('busy', 'A site change is pending');
    this.checkKey(change, key);
    const request: SiteChangeRequest = readSiteChangeRequest({
      id,
      digest,
      requestedAt: new Date(this.now()).toISOString(),
      actor: cut(actor, SITE_CHANGE_ACTOR_LENGTH),
      change,
    });
    return this.write(request, typeof key === 'string' ? key : null);
  }

  private checkKey(change: SiteChange, key: unknown) {
    if (needsKey(change) !== (key !== undefined))
      throw new ArkvoryError('invalid_input', 'key goes with mirror-attach and mirror-key only', {
        reason: 'validation',
        details: [{ field: '/key', problem: needsKey(change) ? 'required' : 'unknown_field' }],
      });
    if (key !== undefined && !isSourceKey(key))
      throw new ArkvoryError('invalid_input', 'key is 16 to 4000 printable characters', {
        reason: 'validation',
        details: [{ field: '/key', problem: 'format' }],
      });
  }

  /** The key first, under the request's id; then the request, which the agent takes. */
  private async write(request: SiteChangeRequest, key: string | null) {
    const inbox = join(this.directory ?? '', 'inbox');
    const keyFile = `${request.id}.key`;
    // An existing key of this id is another attempt's: kept, and never removed by this one.
    const created = key !== null && (await publish(inbox, keyFile, key, 0o600));
    if (!(await publish(inbox, 'change.json', JSON.stringify(request), 0o644))) {
      if (created) await rm(join(inbox, keyFile), { force: true });
      throw new ArkvoryError('busy', 'A site change is pending');
    }
    return { id: request.id };
  }
}

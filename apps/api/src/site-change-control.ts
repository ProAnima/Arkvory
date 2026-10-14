import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  isSourceKey,
  readSiteChangeRequest,
  readSiteChangeStatus,
} from '@proanima/arkvory-contracts';
import type { SiteChange, SiteChangeRequest } from '@proanima/arkvory-contracts';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { mailboxJson, publish } from './mailbox-files.js';

/** A certificate makes a request larger than an update command. */
const REQUEST_LIMIT = 131072;
/** The agent writes its status every minute; five missed ticks mean it is not there. */
const STALE_MS = 5 * 60000;

const needsKey = (change: SiteChange) =>
  change.kind === 'mirror-attach' || change.kind === 'mirror-key';

/**
 * Site changes for the privileged agent (ADR 0077, stage F3) in the updater mailbox of ADR 0038:
 * one request slot, its id remembered by the agent. A source key goes in its own 0600 file next
 * to the request and never into the request, the status or a response.
 */
export class SiteChangeControl {
  /** Requests of this process one after another: the key and the request share one slot. */
  private turn: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly directory?: string,
    private readonly now: () => number = Date.now,
  ) {}

  async status() {
    if (!this.directory) return { agent: false, pending: null, recent: [] };
    const status = await mailboxJson(join(this.directory, 'status/changes.json'));
    const pending = await mailboxJson(join(this.directory, 'inbox/change.json'), REQUEST_LIMIT);
    const read = status === null ? null : readSiteChangeStatus(status);
    const request = pending === null ? null : readSiteChangeRequest(pending);
    return {
      agent: read !== null && this.now() - Date.parse(read.heartbeatAt) <= STALE_MS,
      pending: request && {
        id: request.id,
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
    const status = await this.status();
    if (!this.directory || !status.agent)
      throw new ArkvoryError('unavailable', 'The site agent is not connected or not running');
    if (status.pending?.id === id || status.recent.some((item) => item.id === id)) return { id };
    if (status.pending) throw new ArkvoryError('busy', 'A site change is pending');
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
    const request: SiteChangeRequest = {
      id,
      requestedAt: new Date(this.now()).toISOString(),
      actor,
      change,
    };
    const inbox = join(this.directory, 'inbox');
    // A key left by a request that never got published is stale: the slot is free (no request).
    await rm(join(inbox, 'change.key'), { force: true });
    if (typeof key === 'string' && !(await publish(inbox, 'change.key', key, 0o600)))
      throw new ArkvoryError('busy', 'A site change is pending');
    // The request last: the agent takes a request whose key is already in place.
    if (!(await publish(inbox, 'change.json', JSON.stringify(request), 0o644))) {
      if (typeof key === 'string') await rm(join(inbox, 'change.key'), { force: true });
      throw new ArkvoryError('busy', 'A site change is pending');
    }
    return { id };
  }
}

import { join } from 'node:path';
import { mailboxJson as json, publish } from './mailbox-files.js';
import { readUpdateRequest, readUpdateSnapshot } from '@proanima/arkvory-contracts';
import type { UpdateRequest } from '@proanima/arkvory-contracts';
import { ArkvoryError } from '@proanima/arkvory-domain';

/** A bounded local mailbox, never a shell or a writable installation directory. */
export class UpdateControl {
  constructor(private readonly directory?: string) {}
  async status() {
    if (!this.directory) return { snapshot: null, pending: null };
    const snapshot = await json(join(this.directory, 'status/snapshot.json'));
    const pending = await json(join(this.directory, 'inbox/request.json'));
    return {
      snapshot: snapshot === null ? null : readUpdateSnapshot(snapshot),
      pending: pending === null ? null : readUpdateRequest(pending),
    };
  }
  async request(request: UpdateRequest) {
    const { snapshot, pending } = await this.status();
    if (!this.directory || !snapshot)
      throw new ArkvoryError('unavailable', 'Host updater is not connected');
    if (pending?.id === request.id && JSON.stringify(pending) !== JSON.stringify(request))
      throw new ArkvoryError('conflict', 'Request identity was reused with different fields', {
        reason: 'idempotency_mismatch',
      });
    if (pending?.id === request.id || snapshot.lastRequestId === request.id)
      return { id: request.id };
    if (pending) throw new ArkvoryError('busy', 'An update request is pending');
    if (snapshot.revision !== request.expectedRevision)
      throw new ArkvoryError('conflict', 'Update settings changed', {
        reason: 'revision_mismatch',
      });
    if (snapshot.phase === 'updating' || snapshot.phase === 'checking')
      throw new ArkvoryError('busy', 'Updater is working');
    if (Date.now() - Date.parse(snapshot.heartbeatAt) > 5 * 60000)
      throw new ArkvoryError('unavailable', 'Host updater heartbeat is stale');
    // Commands contain no credentials. A host updater with a different UID must read them;
    // the protected mailbox ancestry controls who can reach these files.
    const published = await publish(
      join(this.directory, 'inbox'),
      'request.json',
      JSON.stringify(request),
      0o644,
    );
    if (!published) throw new ArkvoryError('busy', 'An update request is pending');
    return { id: request.id };
  }
}

import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readUpdateRequest, readUpdateSnapshot } from '@proanima/depot-contracts';
import type { UpdateRequest } from '@proanima/depot-contracts';
import { DepotError } from '@proanima/depot-domain';

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
async function json(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 16384) throw new Error('Invalid update control file');
    const buffer = Buffer.alloc(16385);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16384) throw new Error('Update control file too large');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await file.close();
  }
}
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
      throw new DepotError('unavailable', 'Host updater is not connected');
    if (pending?.id === request.id && JSON.stringify(pending) !== JSON.stringify(request))
      throw new DepotError('conflict', 'Request identity was reused with different fields');
    if (pending?.id === request.id || snapshot.lastRequestId === request.id)
      return { id: request.id };
    if (pending) throw new DepotError('busy', 'An update request is pending');
    if (snapshot.revision !== request.expectedRevision)
      throw new DepotError('conflict', 'Update settings changed');
    if (snapshot.phase === 'updating' || snapshot.phase === 'checking')
      throw new DepotError('busy', 'Updater is working');
    if (Date.now() - Date.parse(snapshot.heartbeatAt) > 5 * 60000)
      throw new DepotError('unavailable', 'Host updater heartbeat is stale');
    const directory = join(this.directory, 'inbox'),
      temporary = join(directory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o644);
    try {
      await file.writeFile(JSON.stringify(request));
      // Commands contain no credentials. A host updater with a different UID must read them;
      // the protected mailbox ancestry controls who can reach these files.
      await file.chmod(0o644);
      await file.sync();
      await file.close();
      try {
        await link(temporary, join(directory, 'request.json'));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
          throw new DepotError('busy', 'An update request is pending');
        throw error;
      }
      // Publish complete bytes with exclusive creation, then make the directory entry durable.
      if (process.platform !== 'win32') {
        const parent = await open(directory, 'r');
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
      return { id: request.id };
    } finally {
      await file.close();
      await unlink(temporary);
    }
  }
}

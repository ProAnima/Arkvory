import type { UpdateSnapshot, UpdateRequest } from '@proanima/arkvory-contracts';
import type { Installation, Release } from './model.js';
import { newer } from './model.js';
import { isUnconfirmedTermination } from './process.js';
import { BackupRequired } from './backup-guard.js';

export interface UpdateMonitorPort {
  save(snapshot: UpdateSnapshot): Promise<void>;
  resolve(): Promise<Release>;
  configure(automatic: boolean): Promise<void>;
  apply(version: string, sha256: string): Promise<Installation>;
}
export function initialUpdateSnapshot(state: Installation, now: string): UpdateSnapshot {
  return {
    revision: 0,
    currentVersion: state.current.version,
    currentSchema: state.current.schema,
    automatic: state.automatic,
    hourUTC: 3,
    pin: state.pin,
    heartbeatAt: now,
    checkedAt: null,
    latest: null,
    phase: 'idle',
    error: null,
    lastAttemptDay: null,
    lastRequestId: null,
  };
}
/** Called under the installation lock. Persist intent before any operation that can stop services. */
export async function monitorUpdates(
  state: Installation,
  previous: UpdateSnapshot,
  request: UpdateRequest | null,
  now: string,
  port: UpdateMonitorPort,
): Promise<UpdateSnapshot> {
  const snapshot = synchronize(previous, state, now);
  const save = () => port.save(snapshot);
  if (request && request.id === snapshot.lastRequestId) {
    await save();
    return snapshot;
  }
  if (request) {
    if (request.expectedRevision !== snapshot.revision) {
      snapshot.error = 'conflict';
      snapshot.phase = 'failed';
      snapshot.lastRequestId = request.id;
      await save();
      return snapshot;
    }
    snapshot.revision++;
  }
  await execute(snapshot, request, now, port);
  if (request) snapshot.lastRequestId = request.id;
  await save();
  return snapshot;
}
function synchronize(previous: UpdateSnapshot, state: Installation, now: string): UpdateSnapshot {
  const snapshot = { ...previous, heartbeatAt: now };
  if (
    snapshot.currentVersion !== state.current.version ||
    snapshot.automatic !== state.automatic ||
    snapshot.pin !== state.pin
  ) {
    snapshot.revision++;
    snapshot.currentVersion = state.current.version;
    snapshot.currentSchema = state.current.schema;
    snapshot.automatic = state.automatic;
    snapshot.pin = state.pin;
  }
  return snapshot;
}
async function execute(
  snapshot: UpdateSnapshot,
  request: UpdateRequest | null,
  now: string,
  port: UpdateMonitorPort,
) {
  const save = () => port.save(snapshot);
  const due =
    snapshot.checkedAt === null || Date.parse(now) - Date.parse(snapshot.checkedAt) >= 6 * 3600000;
  try {
    if (request?.kind === 'configure') {
      await port.configure(request.automatic);
      snapshot.automatic = request.automatic;
      snapshot.hourUTC = request.hourUTC;
      snapshot.error = null;
      snapshot.phase = 'idle';
    } else if (request?.kind === 'apply') {
      const candidate = snapshot.latest;
      if (
        !candidate ||
        candidate.version !== request.version ||
        candidate.sha256 !== request.sha256 ||
        snapshot.pin !== null
      )
        throw new Error('Release selection changed');
      await applyRelease(snapshot, now, port);
    } else {
      if (request?.kind === 'check' || due) {
        snapshot.phase = 'checking';
        await save();
        // Failed checks are also throttled; the last successful candidate stays visible as stale.
        snapshot.checkedAt = now;
        try {
          const release = await port.resolve();
          snapshot.latest = {
            version: release.version,
            schema: release.schema,
            sha256: release.archiveSha256,
          };
          snapshot.error = null;
          snapshot.phase = 'idle';
        } catch {
          snapshot.error = 'check_failed';
          snapshot.phase = 'failed';
        }
      }
      const date = new Date(now),
        day = now.slice(0, 10);
      if (
        !request &&
        snapshot.error === null &&
        snapshot.automatic &&
        snapshot.pin === null &&
        date.getUTCHours() === snapshot.hourUTC &&
        snapshot.lastAttemptDay !== day &&
        snapshot.latest &&
        newer(snapshot.latest.version, snapshot.currentVersion)
      )
        await applyRelease(snapshot, now, port);
    }
  } catch (error) {
    snapshot.phase = 'failed';
    // A schema change without a verified backup was refused before anything changed.
    snapshot.error = isUnconfirmedTermination(error)
      ? 'recovery_required'
      : error instanceof BackupRequired
        ? 'maintenance_required'
        : 'update_failed';
    if (isUnconfirmedTermination(error)) {
      await save().catch(() => undefined);
      throw error;
    }
  }
}
async function applyRelease(snapshot: UpdateSnapshot, now: string, port: UpdateMonitorPort) {
  const latest = snapshot.latest;
  if (!latest || !newer(latest.version, snapshot.currentVersion))
    throw new Error('No newer release');
  snapshot.phase = 'updating';
  snapshot.error = null;
  snapshot.lastAttemptDay = now.slice(0, 10);
  await port.save(snapshot);
  const installed = await port.apply(latest.version, latest.sha256);
  snapshot.currentVersion = installed.current.version;
  snapshot.currentSchema = installed.current.schema;
  snapshot.phase = 'idle';
}

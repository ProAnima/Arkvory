import type { Installation, Release } from './model.js';
import { updateDecision } from './model.js';
import { isUnconfirmedTermination } from './process.js';

export interface UpdatePort {
  stage(release: Release): Promise<void>;
  stop(): Promise<void>;
  start(release: Release): Promise<void>;
  healthy(): Promise<void>;
  save(state: Installation): Promise<void>;
  journal(value: {
    phase: string;
    previous: Release;
    next: Release;
    backup?: string;
  }): Promise<void>;
}
export async function applyUpdate(
  state: Installation,
  next: Release,
  scheduled: boolean,
  port: UpdatePort,
): Promise<boolean> {
  const decision = updateDecision(state, next, scheduled);
  if (decision === 'unchanged') return false;
  if (decision === 'migrate') throw new Error('Schema change requires a verified backup first');
  // Complete download, verification and extraction before interrupting active transfers.
  await port.stage(next);
  await port.journal({ phase: 'prepared', previous: state.current, next });
  try {
    await port.stop();
    await port.journal({ phase: 'stopped', previous: state.current, next });
    await port.save({ ...state, current: next });
    await port.start(next);
    await port.healthy();
    await port.journal({ phase: 'committed', previous: state.current, next });
    return true;
  } catch (error) {
    // A timed-out command may still mutate the installation. Do not race it with rollback;
    // exclusive() retains the operation lock until the operator has fenced that process.
    if (isUnconfirmedTermination(error)) {
      await recoveryJournal(port, 'recovery-required', state.current, next);
      throw error;
    }
    // Same-schema updates never run migrations; restoration of the old executable is safe.
    // A full/broken journal disk must not prevent restoring stopped services. The durable
    // prepared/stopped record already identifies the previous release for manual recovery.
    await recoveryJournal(port, 'rolling-back', state.current, next);
    try {
      await port.stop();
      await port.save(state);
      await port.start(state.current);
      await port.healthy();
    } catch (rollbackError) {
      await recoveryJournal(port, 'recovery-required', state.current, next);
      if (isUnconfirmedTermination(rollbackError)) throw rollbackError;
      throw new Error('Update and rollback failed; inspect services and journal.json', {
        cause: rollbackError,
      });
    }
    if (!(await recoveryJournal(port, 'rolled-back', state.current, next)))
      throw new Error(
        'Update failed; previous release restored but recovery journal could not be saved; inspect journal.json before retrying',
        { cause: error },
      );
    throw new Error('Update failed; previous release restored', { cause: error });
  }
}

async function recoveryJournal(
  port: UpdatePort,
  phase: string,
  previous: Release,
  next: Release,
): Promise<boolean> {
  try {
    await port.journal({ phase, previous, next });
    return true;
  } catch {
    return false;
  }
}

import type { Installation, Release } from './model.js';
import { updateDecision } from './model.js';

export interface UpdatePort {
  stage(release: Release): Promise<void>;
  stop(): Promise<void>;
  start(release: Release): Promise<void>;
  healthy(): Promise<void>;
  save(state: Installation): Promise<void>;
  journal(value: { phase: string; previous: Release; next: Release }): Promise<void>;
}
export async function applyUpdate(
  state: Installation,
  next: Release,
  scheduled: boolean,
  port: UpdatePort,
): Promise<boolean> {
  if (updateDecision(state, next, scheduled) === 'unchanged') return false;
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
  } catch {
    // Same-schema updates never run migrations; restoration of the old executable is safe.
    await port.journal({ phase: 'rolling-back', previous: state.current, next });
    try {
      await port.stop();
      await port.save(state);
      await port.start(state.current);
      await port.healthy();
    } catch {
      await port.journal({ phase: 'recovery-required', previous: state.current, next });
      throw new Error('Update and rollback failed; inspect services and journal.json');
    }
    await port.journal({ phase: 'rolled-back', previous: state.current, next });
    throw new Error('Update failed; previous release restored');
  }
}

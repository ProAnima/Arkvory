import type { Installation, Release } from './model.js';
import { isUnconfirmedTermination } from './process.js';
import type { UpdatePort } from './update.js';

export interface MigrationPort extends UpdatePort {
  /**
   * Proves a recovery point while services still run and names it for the journal. Refuses
   * before anything changed; ADR 0059.
   */
  backup(): Promise<string>;
  /** Runs the migrations of `release`: one transaction, then online indexes; repeatable. */
  migrate(release: Release): Promise<void>;
}

/** Phases of a schema-changing journal before any migration began. */
const untouchedPhases: readonly string[] = ['prepared', 'stopped'];

/**
 * Direction of `recover`. Once `migrating` was journaled the database may hold the newer
 * schema, which the previous release refuses; migrations are repeatable, so recovery continues
 * forward. Before that, and for same-schema updates, the previous release is restored.
 */
export function recoveryDirection(
  previous: Release,
  next: Release,
  phase: string,
): 'back' | 'forward' {
  return next.schema !== previous.schema && !untouchedPhases.includes(phase) ? 'forward' : 'back';
}

/**
 * Schema-changing update (ADR 0059). Before `migrating` is journaled the schema is untouched
 * and the previous release is restored like a same-schema update. A failed migration rolls
 * back its transaction, so the previous release starts again; if it refuses the schema (the
 * index phase after the commit failed), the rollback fails visibly and recovery goes forward.
 * After a successful migration the previous release cannot serve the newer schema: a failed
 * start leaves `maintenance-required` and the backup point is the recovery boundary.
 */
export async function applyMigration(
  state: Installation,
  next: Release,
  port: MigrationPort,
): Promise<void> {
  // Complete download, verification and extraction before the backup and any interruption.
  await port.stage(next);
  const backup = await port.backup();
  const journal = (phase: string) => port.journal({ phase, previous: state.current, next, backup });
  const settle = (phase: string) => journal(phase).catch(() => undefined);
  await journal('prepared');
  await port.stop();
  await journal('stopped');
  await port.save({ ...state, current: next });
  await journal('migrating');
  try {
    await port.migrate(next);
  } catch (error) {
    if (isUnconfirmedTermination(error)) {
      await settle('recovery-required');
      throw error;
    }
    await rollBack(state, port, settle, error);
  }
  await journal('migrated');
  try {
    await port.start(next);
    await port.healthy();
  } catch (error) {
    await settle('maintenance-required');
    if (isUnconfirmedTermination(error)) throw error;
    throw new Error(
      `Database migrated but ${next.version} did not become healthy; fix the cause and run recover, or restore ${backup}`,
      { cause: error },
    );
  }
  await journal('committed');
}

async function rollBack(
  state: Installation,
  port: MigrationPort,
  settle: (phase: string) => Promise<void>,
  failure: unknown,
): Promise<never> {
  await settle('rolling-back');
  try {
    await port.stop();
    await port.save(state);
    await port.start(state.current);
    await port.healthy();
  } catch (error) {
    await settle('maintenance-required');
    if (isUnconfirmedTermination(error)) throw error;
    throw new Error(
      'Migration failed and the previous release does not start; inspect journal.json, then run recover',
      { cause: error },
    );
  }
  await settle('rolled-back');
  throw new Error('Migration failed; previous release restored on the unchanged schema', {
    cause: failure,
  });
}

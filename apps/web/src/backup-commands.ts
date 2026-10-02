import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { BackupPointResponse } from '@proanima/arkvory-contracts';
import { confirmAction } from './confirm-dialog.js';
import { feedback, showFailure } from './feedback.js';
import { withFieldErrors } from './field-errors.js';
import { planFields } from './backup-plan-form.js';
import type { BackupSession, BackupUi } from './backup-session.js';
import { retentionDetails } from './backup-tables.js';

/*
 * Commands of the Backups screen. Each one is queued for the server's backup agent (202): the
 * screen then follows the job through polling, it never reports a queued job as finished.
 */

/** One click is one job: the SDK sends a fresh idempotency key and the button waits for it. */
export function runNow(session: BackupSession, ui: BackupUi) {
  if (session.requesting) return;
  session.requesting = true;
  ui.run.disabled = true;
  session.guard(ui.output, async () => {
    try {
      await session.client.backup.run();
      if (!session.active()) return;
      feedback(ui.output, 'backupRunQueued', {}, 'success');
      await session.refresh(false);
      session.schedule();
    } finally {
      session.requesting = false;
      session.render();
    }
  });
}

export function verifyPoint(
  session: BackupSession,
  ui: BackupUi,
  point: BackupPointResponse,
  button: HTMLButtonElement,
) {
  button.disabled = true;
  session.guard(ui.pointsOutput, async () => {
    try {
      await session.client.backup.verify(point.id);
      if (!session.active()) return;
      feedback(ui.pointsOutput, 'backupVerifyQueued', {}, 'success');
      await session.refresh(false);
      session.schedule();
    } finally {
      // While the verification is open the row keeps the button disabled (render).
      button.disabled = false;
      session.render();
    }
  });
}

export function pinPoint(
  session: BackupSession,
  ui: BackupUi,
  point: BackupPointResponse,
  button: HTMLButtonElement,
) {
  button.disabled = true;
  session.guard(ui.pointsOutput, async () => {
    try {
      const updated = await session.client.backup.pin(point.id, !point.pinned);
      if (!session.active()) return;
      session.replacePoint(updated);
      const done = updated.pinned ? 'backupPinDone' : 'backupUnpinDone';
      feedback(ui.pointsOutput, done, {}, 'success');
    } finally {
      button.disabled = false;
      session.render();
    }
  });
}

/** Shows what retention keeps (with reasons) and removes, and queues it only when confirmed. */
export function applyRetention(session: BackupSession, ui: BackupUi) {
  ui.retention.disabled = true;
  session.guard(ui.pointsOutput, async () => {
    try {
      const preview = await session.client.backup.retentionPreview();
      if (!session.active()) return;
      const details = retentionDetails(preview, session.points);
      const confirmed = await confirmAction(
        'backupRetentionConfirm',
        {},
        'backupRetentionApply',
        details,
      );
      if (!confirmed || !session.active()) return;
      await session.client.backup.applyRetention();
      if (!session.active()) return;
      feedback(ui.pointsOutput, 'backupRetentionQueued', {}, 'success');
      await session.refresh(false);
      session.schedule();
    } finally {
      session.render();
    }
  });
}

const conflict = (error: unknown) =>
  error instanceof ArkvoryHttpError && error.status === 409 && error.reason === 'revision_mismatch';

/** CAS save: a plan saved elsewhere meanwhile is loaded and shown instead of overwritten. */
export function savePlan(session: BackupSession, ui: BackupUi) {
  if (!session.access.plan) return;
  const client = session.client;
  const action = async () => {
    ui.save.disabled = true;
    try {
      const saved = await client.backup.updatePlan(ui.form.read());
      if (!session.active()) return;
      ui.form.fill(saved);
      feedback(ui.form.output, 'backupPlanSaved', { revision: saved.revision }, 'success');
    } catch (error) {
      if (!conflict(error)) throw error;
      const current = await client.backup.plan();
      if (!session.active()) return;
      ui.form.fill(current);
      showFailure(ui.form.output, error, 'backupPlanConflict');
    } finally {
      ui.save.disabled = false;
    }
    // The next run and the schedule warning follow the saved plan.
    session.guard(ui.output, () => session.refresh(false));
  };
  session.guard(ui.form.output, withFieldErrors(planFields, action));
}

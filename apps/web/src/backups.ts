import type { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { showFailure } from './feedback.js';
import { clearMessage } from './i18n.js';
import { onViewOpen, showView } from './shell.js';
import { dismissConfirmation } from './confirm-dialog.js';
import { BackupPlanForm } from './backup-plan-form.js';
import { BackupStatusView } from './backup-status-view.js';
import { JobRows, PointRows } from './backup-tables.js';
import type { PointActions } from './backup-tables.js';
import { BackupSession } from './backup-session.js';
import type { BackupUi } from './backup-session.js';
import { applyRetention, pinPoint, runNow, savePlan, verifyPoint } from './backup-commands.js';

/**
 * The Backups screen (ADR 0056): visible only when operation discovery lists backup.read
 * operations, with changes only for backup.manage. Each sign-in gets a new session; clear()
 * closes it, so nothing of a previous credential is shown or polled.
 */
class BackupConsole {
  private readonly nav = element('backups-nav', HTMLButtonElement);
  private readonly ui: BackupUi;
  private session: BackupSession | undefined;

  constructor(
    private readonly base: string,
    private readonly token: HTMLInputElement,
    private readonly expired: (error: ArkvoryHttpError) => boolean,
  ) {
    this.ui = {
      panel: element('backups-panel', HTMLElement),
      summary: element('backup-summary', HTMLDivElement),
      output: element('backup-status', HTMLOutputElement),
      pointsOutput: element('backup-points-status', HTMLOutputElement),
      run: element('backup-run', HTMLButtonElement),
      retention: element('backup-retention', HTMLButtonElement),
      pointsMore: element('backup-points-more', HTMLButtonElement),
      jobsMore: element('backup-jobs-more', HTMLButtonElement),
      save: element('backup-plan-save', HTMLButtonElement),
      view: new BackupStatusView(),
      form: new BackupPlanForm(),
      pointRows: new PointRows(element('backup-points', HTMLTableSectionElement), () =>
        this.pointActions(),
      ),
      jobRows: new JobRows(element('backup-jobs', HTMLTableSectionElement)),
    };
    this.bind();
  }

  private bind() {
    const ui = this.ui;
    const reload = () => {
      const session = this.session;
      session?.guard(ui.output, () => session.load());
    };
    onViewOpen('backups', reload);
    element('backup-refresh', HTMLButtonElement).onclick = reload;
    ui.run.onclick = () => {
      if (this.session) runNow(this.session, ui);
    };
    ui.retention.onclick = () => {
      if (this.session) applyRetention(this.session, ui);
    };
    ui.pointsMore.onclick = () => {
      const session = this.session;
      session?.guard(ui.pointsOutput, () => session.morePoints());
    };
    ui.jobsMore.onclick = () => {
      const session = this.session;
      session?.guard(ui.output, () => session.moreJobs());
    };
    ui.form.form.onsubmit = (event) => {
      event.preventDefault();
      if (this.session) savePlan(this.session, ui);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.session?.stop();
      else this.session?.resume();
    });
    // Leaving the screen stops polling at once; opening it again reloads through onViewOpen.
    new MutationObserver(() => {
      if (ui.panel.hidden) this.session?.stop();
    }).observe(ui.panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  private pointActions(): PointActions {
    const session = this.session;
    if (!session) return {};
    const ui = this.ui;
    return {
      ...(session.access.verify
        ? {
            verify: (point, button) => {
              verifyPoint(session, ui, point, button);
            },
          }
        : {}),
      ...(session.access.pin
        ? {
            pin: (point, button) => {
              pinPoint(session, ui, point, button);
            },
          }
        : {}),
    };
  }

  /** Discovers the backup permissions of the current credential before restoring links. */
  async connect(): Promise<void> {
    this.clear();
    const session = new BackupSession(this.base, this.token.value, this.ui, this.expired);
    this.session = session;
    try {
      const access = await session.discover();
      if (this.session !== session) return;
      this.nav.hidden = !access.read;
      this.ui.run.hidden = !access.run;
      this.ui.retention.hidden = !access.retention;
      this.ui.form.editable(access.plan);
    } catch (error) {
      // Without discovery the screen stays hidden; the reason is reported like other consoles.
      if (this.session === session) showFailure(element('status', HTMLOutputElement), error);
    }
  }

  clear() {
    this.session?.close();
    this.session = undefined;
    const ui = this.ui;
    this.nav.hidden = true;
    for (const button of [ui.run, ui.retention, ui.pointsMore, ui.jobsMore]) button.hidden = true;
    ui.view.clear();
    ui.pointRows.clear();
    ui.jobRows.clear();
    ui.form.clear();
    clearMessage(ui.output);
    clearMessage(ui.pointsOutput);
    ui.summary.removeAttribute('aria-busy');
    dismissConfirmation();
    if (!ui.panel.hidden) showView('catalog');
  }
}

export function installBackups(
  base: string,
  token: HTMLInputElement,
  expired: (error: ArkvoryHttpError) => boolean,
) {
  return new BackupConsole(base, token, expired);
}

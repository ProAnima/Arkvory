import type { BackupJobResponse, BackupStatusResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, dateMessage, message, relativeMessage } from './i18n.js';
import type { MessageKey } from './messages.js';
import { helpText, node } from './management-dom.js';
import { nextRun, overallState, progressPercent, vaultView } from './backup-model.js';
import { jobStateKeys, kindKeys, phaseKey, stateKeys, warningKeys } from './backup-labels.js';

/** Drops every previous rendering (text key, date, relative time) of a reused node. */
function reset(target: HTMLElement) {
  clearMessage(target);
  target.removeAttribute('datetime');
}
function show(
  target: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string>> = {},
  sizes: readonly string[] = [],
) {
  reset(target);
  message(target, key, params, sizes);
}
function moment(target: HTMLTimeElement, iso: string, relative: boolean) {
  reset(target);
  target.dateTime = iso;
  if (relative) relativeMessage(target, iso);
  else dateMessage(target, iso);
}
function blank(target: HTMLElement) {
  reset(target);
  target.textContent = '—';
}

/** Localized stage of a job; an unknown future phase is shown as its machine code. */
export function showPhase(target: HTMLElement, job: Pick<BackupJobResponse, 'phase' | 'state'>) {
  const key = job.phase === null ? jobStateKeys[job.state] : phaseKey(job.phase);
  if (key) show(target, key);
  else {
    reset(target);
    target.textContent = job.phase ?? '';
  }
}

/**
 * The summary card: overall state, newest point, next run, agent, vault, the running job and
 * the warnings. Polling re-renders it in place; warnings are rebuilt only when their set
 * changes, so an open explanation and keyboard focus survive refreshes.
 */
export class BackupStatusView {
  private readonly state = element('backup-state', HTMLSpanElement);
  private readonly newest = element('backup-newest', HTMLTimeElement);
  private readonly next = element('backup-next', HTMLSpanElement);
  private readonly overdue = element('backup-overdue', HTMLSpanElement);
  private readonly nextUtc = element('backup-next-utc', HTMLSpanElement);
  private readonly agent = element('backup-agent', HTMLSpanElement);
  private readonly seenLabel = element('backup-agent-seen-label', HTMLSpanElement);
  private readonly seen = element('backup-agent-seen', HTMLTimeElement);
  private readonly version = element('backup-agent-version', HTMLSpanElement);
  private readonly vault = element('backup-vault', HTMLElement);
  private readonly running = element('backup-running', HTMLDivElement);
  private readonly runningKind = element('backup-running-kind', HTMLSpanElement);
  private readonly runningPhase = element('backup-running-phase', HTMLSpanElement);
  private readonly progress = element('backup-running-progress', HTMLProgressElement);
  private readonly progressBytes = element('backup-running-bytes', HTMLSpanElement);
  private readonly warnings = element('backup-warnings', HTMLUListElement);
  private signature = '';

  render(status: BackupStatusResponse, now: number) {
    const state = overallState(status.warnings);
    this.state.dataset['state'] = state;
    show(this.state, stateKeys[state]);
    if (status.lastCompleted) moment(this.newest, status.lastCompleted.snapshotAt, true);
    else show(this.newest, 'backupNewestNone');
    this.renderNext(status, now);
    this.renderAgent(status.agent);
    this.renderVault(status);
    this.renderRunning(status.running);
    this.renderWarnings(status.warnings);
  }

  private renderNext(status: BackupStatusResponse, now: number) {
    const run = nextRun(status, now);
    this.overdue.hidden = run.kind !== 'overdue';
    if (run.kind === 'disabled' || run.kind === 'unknown') {
      show(this.next, run.kind === 'disabled' ? 'backupNextDisabled' : 'backupNextUnknown');
      reset(this.nextUtc);
      return;
    }
    reset(this.next);
    dateMessage(this.next, run.at);
    reset(this.nextUtc);
    dateMessage(this.nextUtc, run.at, 'UTC');
  }

  private renderAgent(agent: BackupStatusResponse['agent']) {
    show(this.agent, agent.online ? 'backupAgentOnline' : 'backupAgentOffline');
    this.agent.dataset['tone'] = agent.online ? 'success' : 'error';
    this.seenLabel.hidden = agent.lastSeenAt === null;
    if (agent.lastSeenAt) moment(this.seen, agent.lastSeenAt, true);
    else show(this.seen, 'backupAgentNever');
    if (agent.version) show(this.version, 'backupAgentVersion', { version: agent.version });
    else reset(this.version);
  }

  private renderVault(status: BackupStatusResponse) {
    const vault = vaultView(status);
    switch (vault.kind) {
      case 'available':
        if (vault.free !== null && vault.total !== null)
          show(this.vault, 'backupVaultFree', { free: vault.free, total: vault.total }, [
            'free',
            'total',
          ]);
        else show(this.vault, 'backupVaultAvailable');
        break;
      case 'not_configured':
        show(this.vault, 'backupVaultNotConfigured');
        this.vault.dataset['tone'] = 'warning';
        break;
      case 'unknown':
        show(this.vault, 'backupVaultUnknown');
        break;
      case 'unavailable':
        show(this.vault, 'backupVaultUnavailable');
        this.vault.dataset['tone'] = 'error';
        break;
    }
  }

  private renderRunning(job: BackupJobResponse | null) {
    this.running.hidden = job === null;
    if (!job) return;
    show(this.runningKind, kindKeys[job.kind]);
    showPhase(this.runningPhase, job);
    const percent = progressPercent(job.progress);
    this.progress.hidden = percent === null;
    if (percent === null) reset(this.progressBytes);
    else {
      this.progress.value = percent;
      show(
        this.progressBytes,
        'backupProgressBytes',
        { done: job.progress.bytesCopied, total: job.progress.bytesTotal },
        ['done', 'total'],
      );
    }
  }

  private renderWarnings(warnings: BackupStatusResponse['warnings']) {
    const signature = warnings.map((warning) => warning.code).join(',');
    this.warnings.hidden = warnings.length === 0;
    if (signature === this.signature) return;
    this.signature = signature;
    this.warnings.replaceChildren(
      ...warnings.map((warning) => {
        const item = node('li');
        item.dataset['code'] = warning.code;
        item.dataset['severity'] = warning.severity;
        const severity = node(
          'span',
          warning.severity === 'critical' ? 'backupSeverityCritical' : 'backupSeverityWarning',
          'backup-severity',
        );
        const keys = warningKeys[warning.code];
        item.append(
          severity,
          node('span', keys.text),
          helpText(keys.action, 'backupWarningHelpLabel'),
        );
        return item;
      }),
    );
  }

  clear() {
    this.state.dataset['state'] = 'unknown';
    show(this.state, 'backupStateLoading');
    for (const target of [this.newest, this.next, this.agent, this.vault]) blank(target);
    for (const target of [this.nextUtc, this.seen, this.version, this.progressBytes]) reset(target);
    this.overdue.hidden = true;
    this.seenLabel.hidden = true;
    this.running.hidden = true;
    this.signature = '';
    this.warnings.replaceChildren();
    this.warnings.hidden = true;
  }
}

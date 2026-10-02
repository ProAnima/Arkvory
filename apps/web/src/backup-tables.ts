import type {
  BackupJobResponse,
  BackupPointResponse,
  BackupRetentionPreviewResponse,
  BackupRetentionReasonName,
} from '@proanima/arkvory-contracts';
import { tableState } from './admin-tables.js';
import { bytesMessage, clearMessage, dateMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { node } from './management-dom.js';
import { jobActive, progressPercent, verification } from './backup-model.js';
import { jobStateKeys, kindKeys, reasonKeys, verificationKeys } from './backup-labels.js';
import { showPhase } from './backup-status-view.js';

interface Row<T> {
  readonly element: HTMLTableRowElement;
  update(item: T): void;
}

/**
 * Updates rows in place by id and moves a row only when its position changed: a focused row
 * button survives polling, pinning and paging (a removed and re-inserted node loses focus).
 */
function reconcile<T extends { readonly id: string }>(
  body: HTMLTableSectionElement,
  rows: Map<string, Row<T>>,
  items: readonly T[],
  create: (item: T) => Row<T>,
) {
  const present = new Set(items.map((item) => item.id));
  for (const [id, row] of rows)
    if (!present.has(id)) {
      row.element.remove();
      rows.delete(id);
    }
  items.forEach((item, index) => {
    let row = rows.get(item.id);
    if (!row) {
      row = create(item);
      rows.set(item.id, row);
    }
    row.update(item);
    const current = body.rows[index];
    if (current !== row.element) body.insertBefore(row.element, current ?? null);
  });
  tableState(body);
}

/**
 * A cell with its column name: hidden beside the table header on wide screens, shown when a
 * narrow screen lays rows out as cards. Returns the container of the value.
 */
function cell(row: HTMLTableRowElement, label: MessageKey, className?: string) {
  const result = node('td', undefined, className);
  const value = node('div', undefined, 'backup-cell-value');
  result.append(node('span', label, 'backup-cell-label'), value);
  row.append(result);
  return value;
}
function dash(target: HTMLElement) {
  clearMessage(target);
  target.textContent = '—';
}
function code(value: string) {
  const result = node('code', undefined, 'mono');
  result.textContent = value;
  return result;
}

export interface PointActions {
  /** Absent without the operation: the button is hidden, the server still decides. */
  readonly verify?: (point: BackupPointResponse, button: HTMLButtonElement) => void;
  readonly pin?: (point: BackupPointResponse, button: HTMLButtonElement) => void;
}

export class PointRows {
  private readonly rows = new Map<string, Row<BackupPointResponse>>();
  private verifying: ReadonlySet<string> = new Set();
  constructor(
    private readonly body: HTMLTableSectionElement,
    private readonly actions: () => PointActions,
  ) {}

  /** `verifying` names points with an open verification: their button waits for it. */
  render(points: readonly BackupPointResponse[], verifying: ReadonlySet<string>) {
    this.verifying = verifying;
    reconcile(this.body, this.rows, points, (point) => this.row(point));
  }

  clear() {
    this.rows.clear();
    this.body.replaceChildren();
    tableState(this.body);
  }

  private row(first: BackupPointResponse): Row<BackupPointResponse> {
    const element = node('tr');
    const snapshot = cell(element, 'backupSnapshot');
    const time = node('time');
    time.id = `backup-point-${first.id}-time`;
    const pinnedBadge = node('span', undefined, 'badge');
    snapshot.append(time);
    const completed = node('time');
    cell(element, 'backupCompleted').append(completed);
    const sizeCell = cell(element, 'backupSize');
    const size = node('span');
    const added = node('span', undefined, 'backup-secondary');
    sizeCell.append(size, added);
    const files = cell(element, 'backupFiles');
    const check = cell(element, 'backupVerification');
    const chip = node('span', undefined, 'backup-chip');
    check.append(chip);
    const pinned = cell(element, 'backupPinnedColumn');
    const actions = cell(element, 'actions', 'backup-actions');
    const verify = node('button', 'backupVerifyDeepAction', 'secondary');
    const pin = node('button', undefined, 'secondary');
    for (const button of [verify, pin]) {
      button.type = 'button';
      // The row's snapshot time names the point for assistive technology.
      button.setAttribute('aria-describedby', time.id);
    }
    actions.append(verify, pin);
    let current = first;
    verify.onclick = () => {
      this.actions().verify?.(current, verify);
    };
    pin.onclick = () => {
      this.actions().pin?.(current, pin);
    };
    return {
      element,
      update: (point) => {
        current = point;
        time.dateTime = point.snapshotAt;
        dateMessage(time, point.snapshotAt);
        completed.dateTime = point.completedAt;
        dateMessage(completed, point.completedAt);
        bytesMessage(size, point.contentBytes);
        message(added, 'backupNewBytes', { size: point.newBytes }, ['size']);
        files.textContent = String(point.blobs);
        const state = verification(point);
        chip.dataset['verify'] = state;
        message(chip, verificationKeys[state]);
        check.querySelector('code')?.remove();
        if (point.verifyError) check.append(code(point.verifyError));
        if (point.pinned) {
          message(pinnedBadge, 'backupPinnedYes');
          pinned.replaceChildren(pinnedBadge);
        } else pinned.replaceChildren('—');
        const allowed = this.actions();
        verify.hidden = !allowed.verify;
        verify.disabled = this.verifying.has(point.id);
        pin.hidden = !allowed.pin;
        message(pin, point.pinned ? 'backupUnpin' : 'backupPin');
      },
    };
  }
}

export class JobRows {
  private readonly rows = new Map<string, Row<BackupJobResponse>>();
  constructor(private readonly body: HTMLTableSectionElement) {}

  render(jobs: readonly BackupJobResponse[]) {
    reconcile(this.body, this.rows, jobs, (job) => this.row(job));
  }

  clear() {
    this.rows.clear();
    this.body.replaceChildren();
    tableState(this.body);
  }

  private row(first: BackupJobResponse): Row<BackupJobResponse> {
    const element = node('tr');
    const kind = cell(element, 'backupJobKind');
    const state = node('span', undefined, 'backup-job-state');
    cell(element, 'backupJobState').append(state);
    const phase = cell(element, 'backupJobPhase');
    const started = node('time');
    cell(element, 'backupJobStarted').append(started);
    const finished = node('time');
    cell(element, 'backupJobFinished').append(finished);
    const failure = cell(element, 'backupJobError');
    const progressCell = cell(element, 'backupJobProgress', 'backup-progress');
    const bar = node('progress');
    bar.max = 100;
    const bytes = node('span', undefined, 'backup-secondary');
    bytes.id = `backup-job-${first.id}-bytes`;
    bar.setAttribute('aria-labelledby', bytes.id);
    progressCell.append(bar, bytes);
    return {
      element,
      update: (job) => {
        message(kind, kindKeys[job.kind]);
        state.dataset['state'] = job.state;
        message(state, jobStateKeys[job.state]);
        // A job without a stage yet (queued) or without one at all (refused) shows a dash.
        if (job.phase === null) dash(phase);
        else showPhase(phase, job);
        started.dateTime = job.startedAt;
        dateMessage(started, job.startedAt);
        if (job.finishedAt) {
          finished.dateTime = job.finishedAt;
          dateMessage(finished, job.finishedAt);
        } else {
          finished.removeAttribute('datetime');
          dash(finished);
        }
        failure.replaceChildren(job.errorCode ? code(job.errorCode) : '—');
        const percent = progressPercent(job.progress);
        bar.hidden = percent === null || !jobActive(job.state);
        if (percent !== null) bar.value = percent;
        if (percent === null) dash(bytes);
        else
          message(
            bytes,
            'backupProgressBytes',
            { done: job.progress.bytesCopied, total: job.progress.bytesTotal },
            ['done', 'total'],
          );
      },
    };
  }
}

const previewLimit = 50;
function previewList(
  heading: MessageKey,
  entries: readonly {
    readonly id: string;
    readonly reasons: readonly BackupRetentionReasonName[];
  }[],
  known: ReadonlyMap<string, BackupPointResponse>,
) {
  const section = node('section');
  const title = node('h3');
  message(title, heading, { count: entries.length });
  const list = node('ul');
  for (const entry of entries.slice(0, previewLimit)) {
    const item = node('li');
    const label = node('span');
    const point = known.get(entry.id);
    if (point) dateMessage(label, point.snapshotAt);
    else message(label, 'backupPointShort', { id: entry.id.slice(0, 8) });
    item.append(label, ...entry.reasons.map((reason) => node('span', reasonKeys[reason], 'badge')));
    list.append(item);
  }
  if (entries.length > previewLimit) {
    const more = node('li', undefined, 'hint');
    more.textContent = '…';
    list.append(more);
  }
  section.append(title, list);
  return section;
}

/** What apply would keep (with reasons) and remove now; advisory, apply decides again. */
export function retentionDetails(
  preview: BackupRetentionPreviewResponse,
  points: readonly BackupPointResponse[],
): HTMLElement {
  const known = new Map(points.map((point) => [point.id, point]));
  const root = node('div', undefined, 'backup-retention-preview');
  const removed = previewList(
    'backupRetentionDelete',
    preview.delete.map((entry) => ({ id: entry.id, reasons: [] })),
    known,
  );
  if (!preview.delete.length) removed.append(node('p', 'backupRetentionNothing', 'hint'));
  root.append(removed, previewList('backupRetentionKeep', preview.keep, known));
  return root;
}

import type { DownloadQueue, DownloadState, DownloadSnapshot } from '@proanima/arkvory-sdk';
import type { BrowserDownloadStorage } from './download-storage.js';
import { element } from './dom.js';
import { message } from './i18n.js';
import { errorKey } from './feedback.js';
import type { MessageKey } from './messages.js';
export interface DownloadFile {
  name: string;
  storage: BrowserDownloadStorage;
}
const states: Record<DownloadState, MessageKey> = {
  queued: 'downloadQueued',
  running: 'downloadRunning',
  retrying: 'downloadRetrying',
  pausing: 'downloadPausing',
  paused: 'downloadPaused',
  saving: 'downloadSaving',
  cancelling: 'downloadCancelling',
  cancelled: 'downloadCancelled',
  completed: 'downloadCompleted',
  failed: 'downloadFailed',
};

export class DownloadView {
  private readonly rows = element('download-rows', HTMLTableSectionElement);
  private readonly rendered = new Map<
    string,
    {
      row: HTMLTableRowElement;
      state: HTMLElement;
      bytes: HTMLElement;
      pause: HTMLButtonElement;
      resume: HTMLButtonElement;
      cancel: HTMLButtonElement;
    }
  >();
  constructor(
    private readonly queue: DownloadQueue,
    private readonly files: Map<string, DownloadFile>,
    private readonly resume: (id: string) => void,
    private readonly cancel: (id: string) => void,
  ) {
    queue.subscribe(() => {
      this.render();
    });
    this.render();
  }
  private button(key: MessageKey, action: () => void) {
    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'secondary small';
    message(result, key);
    result.onclick = action;
    return result;
  }
  render() {
    this.renderRows(this.queue.snapshot);
    this.renderToolbar(this.queue.snapshot);
  }
  private renderRows(snapshots: readonly DownloadSnapshot[]) {
    const present = new Set(snapshots.map((item) => item.id));
    for (const [id, view] of this.rendered)
      if (!present.has(id)) {
        view.row.remove();
        this.rendered.delete(id);
        this.files.delete(id);
      }
    for (const item of snapshots) {
      let view = this.rendered.get(item.id);
      if (!view) {
        const row = document.createElement('tr');
        const name = document.createElement('td'),
          state = document.createElement('td'),
          bytes = document.createElement('td'),
          actions = document.createElement('td');
        name.textContent = this.files.get(item.id)?.name ?? item.id;
        const pause = this.button('pause', () => {
          this.queue.pause(item.id);
        });
        const resume = this.button('downloadResume', () => {
          this.resume(item.id);
        });
        const cancel = this.button('downloadCancel', () => {
          this.cancel(item.id);
        });
        const controls = document.createElement('div');
        controls.className = 'download-actions';
        controls.append(pause, resume, cancel);
        actions.append(controls);
        row.append(name, state, bytes, actions);
        this.rows.append(row);
        view = { row, state, bytes, pause, resume, cancel };
        this.rendered.set(item.id, view);
      }
      if (item.state === 'retrying' && item.retry)
        message(view.state, 'downloadRetryDelay', {
          seconds: Math.ceil(item.retry.delayMs / 1000),
        });
      else if (item.state === 'completed' && item.error)
        message(view.state, 'downloadCleanupFailed');
      else if (item.state === 'failed') message(view.state, errorKey(item.error));
      else if (item.state === 'paused' && !this.files.get(item.id)?.storage.destination)
        message(view.state, 'downloadRestored');
      else message(view.state, states[item.state]);
      message(view.bytes, 'downloadBytes', { bytes: item.bytes });
      view.pause.disabled = !['queued', 'running', 'retrying'].includes(item.state);
      view.resume.disabled = !item.resumable;
      view.cancel.disabled = ['saving', 'completed', 'cancelled', 'cancelling'].includes(
        item.state,
      );
    }
  }
  private renderToolbar(snapshots: readonly DownloadSnapshot[]) {
    const focused = document.activeElement;
    element('download-empty', HTMLElement).hidden = snapshots.length > 0;
    element('download-table', HTMLElement).hidden = snapshots.length === 0;
    element('download-held', HTMLElement).hidden = !this.queue.paused;
    const hasState = (...states: DownloadState[]) =>
      snapshots.some((item) => states.includes(item.state));
    element('downloads-pause', HTMLButtonElement).disabled = this.queue.paused;
    element('downloads-resume', HTMLButtonElement).disabled =
      !this.queue.paused &&
      !snapshots.some(
        (item) =>
          ['paused', 'pausing'].includes(item.state) &&
          this.files.get(item.id)?.storage.destination,
      );
    element('downloads-clear-waiting', HTMLButtonElement).disabled = !hasState('queued', 'paused');
    element('downloads-cancel', HTMLButtonElement).disabled = !hasState(
      'queued',
      'running',
      'retrying',
      'paused',
      'pausing',
      'failed',
    );
    element('downloads-clear-finished', HTMLButtonElement).disabled = !hasState(
      'completed',
      'cancelled',
      'failed',
    );
    for (const id of ['downloads-clear-waiting', 'downloads-cancel', 'downloads-clear-finished']) {
      const control = element(id, HTMLButtonElement);
      control.hidden = control.disabled;
    }
    element('downloads-pause', HTMLButtonElement).hidden = this.queue.paused;
    element('downloads-resume', HTMLButtonElement).hidden =
      !this.queue.paused && !hasState('paused', 'pausing');
    if (
      focused instanceof HTMLButtonElement &&
      focused.closest('.download-toolbar') &&
      focused.hidden
    ) {
      // A completed action may disappear; keep keyboard users in the same toolbar.
      element(this.queue.paused ? 'downloads-resume' : 'downloads-pause', HTMLButtonElement).focus({
        preventScroll: true,
      });
    }
    message(element('download-summary', HTMLElement), 'downloadSummary', {
      active: snapshots.filter((item) =>
        ['running', 'retrying', 'pausing', 'saving', 'cancelling'].includes(item.state),
      ).length,
      waiting: snapshots.filter((item) => item.state === 'queued').length,
      count: snapshots.length,
    });
  }
}

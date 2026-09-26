import { ArkvoryClient, DownloadQueue, checkpointedDownload } from '@proanima/arkvory-sdk';
import type { DownloadState } from '@proanima/arkvory-sdk';
import { BrowserDownloadStorage, openDownloadWorkspace } from './download-storage.js';
import { element } from './dom.js';
import { message } from './i18n.js';
import { feedback, UiError, errorKey } from './feedback.js';
import type { MessageKey } from './messages.js';
import { showView } from './shell.js';

declare global {
  interface Window {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  }
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

// arkvory-exception ARCH-025 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installDownloads(baseUrl: string, token: HTMLInputElement) {
  const queue = new DownloadQueue();
  const rows = element('download-rows', HTMLTableSectionElement);
  const status = element('download-status', HTMLOutputElement);
  const files = new Map<string, { name: string; destination: FileSystemFileHandle }>();
  const rendered = new Map<
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
  let workspace: Promise<FileSystemDirectoryHandle> | undefined;
  let generation = 0;
  let adding = false;
  let resetting = Promise.resolve();
  const run = (work: () => unknown) => {
    void Promise.resolve()
      .then(work)
      .catch((error: unknown) => {
        feedback(status, errorKey(error), {}, 'error');
      });
  };
  const button = (key: MessageKey, action: () => void) => {
    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'secondary small';
    message(result, key);
    result.onclick = action;
    return result;
  };
  function render() {
    const focused = document.activeElement;
    const snapshots = queue.snapshot;
    const present = new Set(snapshots.map((item) => item.id));
    for (const [id, view] of rendered)
      if (!present.has(id)) {
        view.row.remove();
        rendered.delete(id);
        files.delete(id);
      }
    for (const item of snapshots) {
      let view = rendered.get(item.id);
      if (!view) {
        const row = document.createElement('tr');
        const name = document.createElement('td'),
          state = document.createElement('td'),
          bytes = document.createElement('td'),
          actions = document.createElement('td');
        name.textContent = files.get(item.id)?.name ?? item.id;
        const pause = button('pause', () => {
          queue.pause(item.id);
        });
        const resume = button('downloadResume', () => {
          queue.resume(item.id);
        });
        const cancel = button('downloadCancel', () => {
          run(() => queue.cancel(item.id));
        });
        const controls = document.createElement('div');
        controls.className = 'download-actions';
        controls.append(pause, resume, cancel);
        actions.append(controls);
        row.append(name, state, bytes, actions);
        rows.append(row);
        view = { row, state, bytes, pause, resume, cancel };
        rendered.set(item.id, view);
      }
      if (item.state === 'retrying' && item.retry)
        message(view.state, 'downloadRetryDelay', {
          seconds: Math.ceil(item.retry.delayMs / 1000),
        });
      else if (item.state === 'completed' && item.error)
        message(view.state, 'downloadCleanupFailed');
      else if (item.state === 'failed') message(view.state, errorKey(item.error));
      else message(view.state, states[item.state]);
      message(view.bytes, 'downloadBytes', { bytes: item.bytes });
      view.pause.disabled = !['queued', 'running', 'retrying'].includes(item.state);
      view.resume.disabled = !item.resumable;
      view.cancel.disabled = ['saving', 'completed', 'cancelled', 'cancelling'].includes(
        item.state,
      );
    }
    element('download-empty', HTMLElement).hidden = snapshots.length > 0;
    element('download-table', HTMLElement).hidden = snapshots.length === 0;
    element('download-held', HTMLElement).hidden = !queue.paused;
    const hasState = (...states: DownloadState[]) =>
      snapshots.some((item) => states.includes(item.state));
    element('downloads-pause', HTMLButtonElement).disabled = queue.paused;
    element('downloads-resume', HTMLButtonElement).disabled =
      !queue.paused && !hasState('paused', 'pausing');
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
    element('downloads-pause', HTMLButtonElement).hidden = queue.paused;
    element('downloads-resume', HTMLButtonElement).hidden =
      !queue.paused && !hasState('paused', 'pausing');
    if (
      focused instanceof HTMLButtonElement &&
      focused.closest('.download-toolbar') &&
      focused.hidden
    ) {
      // A completed action may disappear; keep keyboard users in the same toolbar.
      element(queue.paused ? 'downloads-resume' : 'downloads-pause', HTMLButtonElement).focus({
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
  queue.subscribe(render);
  render();
  element('downloads-pause', HTMLButtonElement).onclick = () => {
    queue.pauseAll();
  };
  element('downloads-resume', HTMLButtonElement).onclick = () => {
    queue.resumeAll();
  };
  element('downloads-clear-waiting', HTMLButtonElement).onclick = () => {
    run(() => queue.clearWaiting());
  };
  element('downloads-cancel', HTMLButtonElement).onclick = () => {
    run(() => queue.cancelAll());
  };
  element('downloads-clear-finished', HTMLButtonElement).onclick = () => {
    run(() => queue.clearFinished());
  };
  element('download-policy', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(() => {
      queue.configure({
        concurrency: Number(element('download-concurrency', HTMLInputElement).value),
        startIntervalMs: Number(element('download-interval', HTMLInputElement).value),
        queueTimeoutMs: Number(element('download-wait', HTMLInputElement).value) * 1000,
      });
      feedback(status, 'downloadPolicySaved', {}, 'success');
    });
  };
  const reset = () => {
    generation++;
    // Keep the queue held: an old job must not restart under a different identity.
    queue.pauseAll();
    resetting = resetting.then(async () => {
      await queue.cancelAll();
      await queue.clearFinished();
      queue.resumeAll();
    });
    run(() => resetting);
  };
  token.addEventListener('input', reset);
  window.addEventListener('beforeunload', (event) => {
    if (queue.snapshot.some((item) => !['completed', 'cancelled'].includes(item.state))) {
      event.preventDefault();
    }
  });
  return {
    reset,
    async enqueue(repository: string, artifactId: string, name: string) {
      if (adding) return;
      const browser: { storage?: { getDirectory?: unknown }; locks?: unknown } = navigator;
      if (
        !window.showSaveFilePicker ||
        typeof browser.storage?.getDirectory !== 'function' ||
        !browser.locks
      )
        throw new UiError('saveUnsupported');
      const current = generation,
        secret = token.value;
      adding = true;
      try {
        // Picker must run directly under the user's gesture, before any network await.
        const destination = await window.showSaveFilePicker({ suggestedName: name });
        await resetting;
        for (const file of files.values())
          if (await destination.isSameEntry(file.destination))
            throw new UiError('downloadDuplicate');
        workspace ??= openDownloadWorkspace().catch((error: unknown) => {
          workspace = undefined;
          throw error;
        });
        const directory = await workspace;
        if (current !== generation || secret !== token.value) return;
        const id = crypto.randomUUID();
        const client = new ArkvoryClient(baseUrl, () => secret);
        files.set(id, { name, destination });
        try {
          queue.enqueue(
            checkpointedDownload(
              client,
              id,
              repository,
              artifactId,
              new BrowserDownloadStorage(directory, id, destination),
            ),
          );
        } catch (error) {
          files.delete(id);
          throw error;
        }
        showView('downloads');
        feedback(status, 'downloadAdded', {}, 'success');
      } finally {
        adding = false;
      }
    },
  };
}

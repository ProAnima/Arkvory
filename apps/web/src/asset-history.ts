import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { AssetRevisionResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, dateMessage } from './i18n.js';
import { feedback, showFailure } from './feedback.js';

interface HistoryView {
  repository: string;
  path: string;
  revision: number;
  next: number | null;
}
/** One history request at a time; `view` identifies the path whose rows are on screen. */
interface HistoryState {
  pending: AbortController | undefined;
  view: HistoryView | undefined;
}
interface HistoryActions {
  open: (repository: string, id: string, name: string) => Promise<void>;
  restore: (item: AssetRevisionResponse, snapshot: HistoryView, button: HTMLButtonElement) => void;
  run: (action: () => Promise<void>) => void;
}

/** The reload may have replaced the view; report only while the same path is on screen. */
function showsPath(state: HistoryState, snapshot: HistoryView) {
  return state.view?.repository === snapshot.repository && state.view.path === snapshot.path;
}

function historyRow(item: AssetRevisionResponse, snapshot: HistoryView, actions: HistoryActions) {
  const row = document.createElement('tr');
  for (const [index, value] of [
    String(item.revision),
    item.createdAt ?? '—',
    item.actor ?? '—',
    item.sourceRevision === null ? '—' : String(item.sourceRevision),
  ].entries()) {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (index === 1 && item.createdAt !== null) dateMessage(cell, item.createdAt);
    row.append(cell);
  }
  const cell = document.createElement('td');
  const select = document.createElement('button');
  message(select, 'open');
  select.className = 'secondary';
  select.onclick = () => {
    actions.run(() =>
      actions.open(snapshot.repository, item.artifactId, item.path.split('/').at(-1) ?? item.path),
    );
  };
  const restore = document.createElement('button');
  message(restore, 'restore', { revision: item.revision });
  restore.disabled = item.revision === snapshot.revision;
  restore.onclick = () => {
    actions.restore(item, snapshot, restore);
  };
  cell.append(select, restore);
  row.append(cell);
  return row;
}

export function installAssetHistory(
  client: ArkvoryClient,
  repository: HTMLInputElement,
  token: HTMLInputElement,
  open: (repository: string, id: string, name: string) => Promise<void>,
  run: (action: () => Promise<void>) => void,
) {
  const path = element('history-path', HTMLInputElement);
  const rows = element('asset-history', HTMLTableSectionElement);
  const more = element('history-more', HTMLButtonElement);
  const status = element('history-status', HTMLOutputElement);
  const state: HistoryState = { pending: undefined, view: undefined };
  const reset = () => {
    state.pending?.abort();
    state.pending = undefined;
    state.view = undefined;
    rows.replaceChildren();
    more.disabled = true;
    feedback(status, 'historyEmpty');
  };
  for (const input of [path, repository, token]) input.addEventListener('input', reset);
  const actions: HistoryActions = {
    open,
    run,
    restore: (item, snapshot, button) => {
      run(async () => {
        if (state.pending || state.view !== snapshot) return;
        const controller = new AbortController();
        state.pending = controller;
        button.disabled = true;
        try {
          const result = await client.restoreAsset(
            snapshot.repository,
            snapshot.path,
            item.revision,
            snapshot.revision,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          state.pending = undefined;
          await load();
          if (showsPath(state, snapshot))
            feedback(status, 'restored', { revision: result.revision }, 'success');
        } catch (error) {
          if (controller.signal.aborted) return;
          // The history view has its own wording for a stale path; the reference still shows.
          if (error instanceof ArkvoryHttpError && error.code === 'conflict')
            showFailure(status, error, 'historyConflict');
          else throw error;
        } finally {
          if (state.pending === controller) state.pending = undefined;
          button.disabled = false;
        }
      });
    },
  };
  async function load(before?: number) {
    if (before === undefined) reset();
    if (state.pending) return;
    const controller = new AbortController();
    state.pending = controller;
    more.disabled = true;
    const repo = repository.value,
      assetPath = path.value;
    try {
      const page = await client.assetHistory(repo, assetPath, before, controller.signal);
      if (controller.signal.aborted) return;
      if (before === undefined)
        state.view = {
          repository: repo,
          path: assetPath,
          revision: page.items[0]?.revision ?? 0,
          next: page.next,
        };
      const view = state.view;
      if (!view) return;
      view.next = page.next;
      for (const item of page.items) rows.append(historyRow(item, view, actions));
      feedback(status, 'historyCount', { count: rows.rows.length, revision: view.revision });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (state.pending === controller) {
        state.pending = undefined;
        more.disabled = state.view?.next === undefined || state.view.next === null;
      }
    }
  }
  element('history', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(() => load());
  };
  more.onclick = () => {
    if (state.view?.next) run(() => load(state.view?.next ?? undefined));
  };
  return reset;
}

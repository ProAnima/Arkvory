import { DepotHttpError } from '@proanima/depot-sdk';
import type { DepotClient } from '@proanima/depot-sdk';
import type { AssetRevisionResponse } from '@proanima/depot-contracts';
import { element } from './dom.js';

export function installAssetHistory(
  client: DepotClient,
  repository: HTMLInputElement,
  token: HTMLInputElement,
  open: (repository: string, id: string, name: string) => Promise<void>,
  run: (action: () => Promise<void>) => void,
) {
  const path = element('history-path', HTMLInputElement);
  const rows = element('asset-history', HTMLTableSectionElement);
  const more = element('history-more', HTMLButtonElement);
  const status = element('history-status', HTMLOutputElement);
  let pending: AbortController | undefined;
  let view: { repository: string; path: string; revision: number; next: number | null } | undefined;
  const reset = () => {
    pending?.abort();
    pending = undefined;
    view = undefined;
    rows.replaceChildren();
    more.disabled = true;
    status.textContent = 'Загрузите историю / Load history';
  };
  for (const input of [path, repository, token]) input.addEventListener('input', reset);
  function restored(repo: string, assetPath: string, revision: number) {
    if (view?.repository === repo && view.path === assetPath)
      status.textContent = `Восстановлено как ревизия / Restored as revision ${String(revision)}`;
  }

  async function load(before?: number) {
    if (before === undefined) reset();
    if (pending) return;
    const controller = new AbortController();
    pending = controller;
    more.disabled = true;
    const repo = repository.value,
      assetPath = path.value;
    try {
      const page = await client.assetHistory(repo, assetPath, before, controller.signal);
      if (controller.signal.aborted) return;
      if (before === undefined)
        view = {
          repository: repo,
          path: assetPath,
          revision: page.items[0]?.revision ?? 0,
          next: page.next,
        };
      if (!view) return;
      view.next = page.next;
      for (const item of page.items) append(item, view);
      status.textContent = `Ревизий / Revisions: ${String(rows.rows.length)} · Текущая / Current: ${String(view.revision)}`;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (pending === controller) {
        pending = undefined;
        more.disabled = view?.next === undefined || view.next === null;
      }
    }
  }
  function append(item: AssetRevisionResponse, snapshot: NonNullable<typeof view>) {
    const row = document.createElement('tr');
    for (const value of [
      String(item.revision),
      item.createdAt === null ? '—' : new Date(item.createdAt).toLocaleString(),
      item.actor ?? '—',
      item.sourceRevision === null ? '—' : String(item.sourceRevision),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actions = document.createElement('td');
    const select = document.createElement('button');
    select.textContent = 'Открыть / Open';
    select.className = 'secondary';
    select.onclick = () => {
      run(() =>
        open(snapshot.repository, item.artifactId, item.path.split('/').at(-1) ?? item.path),
      );
    };
    const restore = document.createElement('button');
    restore.textContent = `Восстановить / Restore r${String(item.revision)}`;
    restore.disabled = item.revision === snapshot.revision;
    restore.onclick = () => {
      run(async () => {
        if (pending || view !== snapshot) return;
        const controller = new AbortController();
        pending = controller;
        restore.disabled = true;
        try {
          const result = await client.restoreAsset(
            snapshot.repository,
            snapshot.path,
            item.revision,
            snapshot.revision,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          pending = undefined;
          await load();
          restored(snapshot.repository, snapshot.path, result.revision);
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof DepotHttpError && error.status === 409)
            status.textContent =
              'Файл изменён. Обновите историю перед восстановлением. / File changed. Reload history before restoring.';
          else throw error;
        } finally {
          if (pending === controller) pending = undefined;
          restore.disabled = false;
        }
      });
    };
    actions.append(select, restore);
    row.append(actions);
    rows.append(row);
  }
  element('history', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(() => load());
  };
  more.onclick = () => {
    if (view?.next) run(() => load(view?.next ?? undefined));
  };
  return reset;
}

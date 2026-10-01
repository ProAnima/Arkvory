import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { PackageResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { decorateStages, packageRow } from './package-stages.js';

// arkvory-exception ARCH-027 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installPackageView(
  client: ArkvoryClient,
  repository: HTMLInputElement,
  token: HTMLInputElement,
  run: (action: () => Promise<void>) => void,
  open: (id: string) => Promise<void>,
) {
  const rows = element('package-rows', HTMLTableSectionElement);
  const status = element('package-status', HTMLOutputElement);
  const pageTop = element('package-page-top', HTMLSpanElement);
  const pages = [pageTop, element('package-page', HTMLSpanElement)];
  const previous = [
    element('package-prev-top', HTMLButtonElement),
    element('package-prev', HTMLButtonElement),
  ];
  const next = [
    element('package-next-top', HTMLButtonElement),
    element('package-next', HTMLButtonElement),
  ];
  let generation = 0;
  let cursors: (string | undefined)[] = [undefined];
  let pageIndex = 0;
  let nextCursor: string | null = null;
  const controls = (busy: boolean) => {
    for (const button of previous) button.disabled = busy || pageIndex === 0;
    for (const button of next) button.disabled = busy || nextCursor === null;
  };
  const resetPage = () => {
    generation++;
    cursors = [undefined];
    pageIndex = 0;
    nextCursor = null;
    controls(false);
  };
  const clear = () => {
    resetPage();
    rows.replaceChildren();
    clearMessage(status);
    for (const page of pages) clearMessage(page);
  };
  for (const field of [repository, token]) field.addEventListener('input', clear);
  const select = <T extends string>(id: string, allowed: readonly T[], fallback: T): T => {
    const value = element(id, HTMLSelectElement).value;
    return allowed.find((item) => item === value) ?? fallback;
  };
  const add = (item: PackageResponse) => {
    rows.append(
      packageRow(item, () => {
        run(() => open(item.artifactId));
      }),
    );
  };
  const refresh = async () => {
    const current = ++generation;
    controls(true);
    const repo = repository.value;
    const after = cursors[pageIndex];
    const group = element('package-group', HTMLInputElement).value;
    const name = element('package-name', HTMLInputElement).value;
    let result;
    try {
      result = await client.packages(repo, {
        ...(group ? { group } : {}),
        ...(name ? { name } : {}),
        sort: select('package-sort', ['group', 'name', 'version'], 'group'),
        direction: select('package-direction', ['asc', 'desc'], 'asc'),
        groupBy: select('package-group-by', ['group', 'package', 'none'], 'group'),
        ...(after ? { after } : {}),
      });
    } catch (error) {
      if (current !== generation) return;
      controls(false);
      throw error;
    }
    if (current !== generation || repo !== repository.value) return;
    rows.replaceChildren();
    if (result.groups.length) {
      for (const group of result.groups) {
        const header = document.createElement('tr');
        header.className = 'group-row';
        const title = document.createElement('th');
        title.colSpan = 5;
        title.scope = 'rowgroup';
        title.textContent = group.name
          ? `${group.group || '—'} / ${group.name}`
          : group.group || '—';
        header.append(title);
        rows.append(header);
        for (const item of group.items) add(item);
      }
    } else for (const item of result.items) add(item);
    // Stage chips are decorative; a missing artifact.list permission leaves them empty.
    void decorateStages(client, repo, rows).catch(() => undefined);
    message(status, result.items.length ? 'packageCount' : 'noPackages', {
      count: result.items.length,
    });
    nextCursor = result.next;
    controls(false);
    for (const page of pages) message(page, 'pageNumber', { page: pageIndex + 1 });
  };
  element('package-filter', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    resetPage();
    run(refresh);
  };
  const filters = [
    'package-group',
    'package-name',
    'package-sort',
    'package-direction',
    'package-group-by',
  ] as const;
  for (const id of filters)
    element(id, HTMLElement).addEventListener('change', () => {
      resetPage();
      rows.replaceChildren();
      for (const page of pages) clearMessage(page);
      message(status, 'applyFilters');
    });
  element('package-clear', HTMLButtonElement).onclick = () => {
    element('package-group', HTMLInputElement).value = '';
    element('package-name', HTMLInputElement).value = '';
    element('package-sort', HTMLSelectElement).value = 'group';
    element('package-direction', HTMLSelectElement).value = 'asc';
    element('package-group-by', HTMLSelectElement).value = 'group';
    resetPage();
    if (token.value) run(refresh);
    else clear();
  };
  const navigate = (target: number, cursor?: string) => {
    const before = pageIndex;
    pageIndex = target;
    if (cursor) cursors[target] = cursor;
    run(async () => {
      try {
        const current = generation + 1;
        await refresh();
        if (current === generation) pageTop.focus({ preventScroll: false });
      } catch (error) {
        if (pageIndex === target) {
          pageIndex = before;
          controls(false);
        }
        throw error;
      }
    });
  };
  for (const button of previous)
    button.onclick = () => {
      if (pageIndex > 0) navigate(pageIndex - 1);
    };
  for (const button of next)
    button.onclick = () => {
      if (nextCursor) navigate(pageIndex + 1, nextCursor);
    };
  document
    .querySelector<HTMLButtonElement>('[data-nav="packages"]')
    ?.addEventListener('click', () => {
      resetPage();
      run(refresh);
    });
  return clear;
}

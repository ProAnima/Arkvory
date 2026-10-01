import { feedback } from './feedback.js';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { PackageResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { decorateStages, packageRow } from './package-stages.js';
import { onViewOpen } from './shell.js';

type PackagePage = Awaited<ReturnType<ArkvoryClient['packages']>>;
const filters = [
  'package-group',
  'package-name',
  'package-sort',
  'package-direction',
  'package-group-by',
] as const;

function select<T extends string>(id: string, allowed: readonly T[], fallback: T): T {
  const value = element(id, HTMLSelectElement).value;
  return allowed.find((item) => item === value) ?? fallback;
}

function packageQuery(after: string | undefined) {
  const group = element('package-group', HTMLInputElement).value;
  const name = element('package-name', HTMLInputElement).value;
  return {
    ...(group ? { group } : {}),
    ...(name ? { name } : {}),
    sort: select('package-sort', ['group', 'name', 'version'], 'group'),
    direction: select('package-direction', ['asc', 'desc'], 'asc'),
    groupBy: select('package-group-by', ['group', 'package', 'none'], 'group'),
    ...(after ? { after } : {}),
  };
}

function resetFilterFields() {
  element('package-group', HTMLInputElement).value = '';
  element('package-name', HTMLInputElement).value = '';
  element('package-sort', HTMLSelectElement).value = 'group';
  element('package-direction', HTMLSelectElement).value = 'asc';
  element('package-group-by', HTMLSelectElement).value = 'group';
}

function renderPackages(
  rows: HTMLTableSectionElement,
  result: PackagePage,
  open: (item: PackageResponse) => void,
) {
  rows.replaceChildren();
  const add = (item: PackageResponse) => {
    rows.append(
      packageRow(item, () => {
        open(item);
      }),
    );
  };
  if (!result.groups.length) {
    for (const item of result.items) add(item);
    return;
  }
  for (const group of result.groups) {
    const header = document.createElement('tr');
    header.className = 'group-row';
    const title = document.createElement('th');
    title.colSpan = 5;
    title.scope = 'rowgroup';
    if (group.name)
      message(title, 'packageGroupHeading', { group: group.group || '—', name: group.name });
    else title.textContent = group.group || '—';
    header.append(title);
    rows.append(header);
    for (const item of group.items) add(item);
  }
}

interface PagerState {
  generation: number;
  cursors: (string | undefined)[];
  page: number;
  next: string | null;
}

/** Cursor pagination shared by the top and bottom toolbars; a failed page keeps the old one. */
function packagePager(run: (action: () => Promise<void>) => void, refresh: () => Promise<void>) {
  const pageTop = element('package-page-top', HTMLSpanElement);
  const previous = [
    element('package-prev-top', HTMLButtonElement),
    element('package-prev', HTMLButtonElement),
  ];
  const next = [
    element('package-next-top', HTMLButtonElement),
    element('package-next', HTMLButtonElement),
  ];
  const state: PagerState = { generation: 0, cursors: [undefined], page: 0, next: null };
  const controls = (busy: boolean) => {
    for (const button of previous) button.disabled = busy || state.page === 0;
    for (const button of next) button.disabled = busy || state.next === null;
  };
  const navigate = (target: number, cursor?: string) => {
    const before = state.page;
    state.page = target;
    if (cursor) state.cursors[target] = cursor;
    run(async () => {
      try {
        const current = state.generation + 1;
        await refresh();
        if (current === state.generation) pageTop.focus({ preventScroll: false });
      } catch (error) {
        if (state.page === target) {
          state.page = before;
          controls(false);
        }
        throw error;
      }
    });
  };
  for (const button of previous)
    button.onclick = () => {
      if (state.page > 0) navigate(state.page - 1);
    };
  for (const button of next)
    button.onclick = () => {
      if (state.next) navigate(state.page + 1, state.next);
    };
  return {
    state,
    controls,
    pages: [pageTop, element('package-page', HTMLSpanElement)],
    reset() {
      state.generation++;
      state.cursors = [undefined];
      state.page = 0;
      state.next = null;
      controls(false);
    },
  };
}

export function installPackageView(
  client: ArkvoryClient,
  repository: HTMLInputElement,
  token: HTMLInputElement,
  run: (action: () => Promise<void>) => void,
  open: (id: string) => Promise<void>,
) {
  const rows = element('package-rows', HTMLTableSectionElement);
  const status = element('package-status', HTMLOutputElement);
  const pager = packagePager(run, () => refresh());
  const { state, pages } = pager;
  const clear = () => {
    pager.reset();
    rows.replaceChildren();
    clearMessage(status);
    for (const page of pages) clearMessage(page);
  };
  for (const field of [repository, token]) field.addEventListener('input', clear);
  const refresh = async () => {
    const current = ++state.generation;
    pager.controls(true);
    const repo = repository.value;
    let result;
    try {
      result = await client.packages(repo, packageQuery(state.cursors[state.page]));
    } catch (error) {
      if (current !== state.generation) return;
      pager.controls(false);
      throw error;
    }
    if (current !== state.generation || repo !== repository.value) return;
    renderPackages(rows, result, (item) => {
      run(() => open(item.artifactId));
    });
    // Stage chips are decorative; a missing artifact.list permission leaves them empty.
    void decorateStages(client, repo, rows).catch(() => undefined);
    feedback(status, result.items.length ? 'packageCount' : 'noPackages', {
      count: result.items.length,
    });
    state.next = result.next;
    pager.controls(false);
    for (const page of pages) message(page, 'pageNumber', { page: state.page + 1 });
  };
  element('package-filter', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    pager.reset();
    run(refresh);
  };
  for (const id of filters)
    element(id, HTMLElement).addEventListener('change', () => {
      pager.reset();
      rows.replaceChildren();
      for (const page of pages) clearMessage(page);
      feedback(status, 'applyFilters');
    });
  element('package-clear', HTMLButtonElement).onclick = () => {
    resetFilterFields();
    pager.reset();
    if (token.value) run(refresh);
    else clear();
  };
  onViewOpen('packages', () => {
    pager.reset();
    run(refresh);
  });
  return clear;
}

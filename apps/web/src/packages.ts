import type { DepotClient } from '@proanima/depot-sdk';
import type { PackageResponse } from '@proanima/depot-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';

export function installPackageView(
  client: DepotClient,
  repository: HTMLInputElement,
  token: HTMLInputElement,
  run: (action: () => Promise<void>) => void,
  open: (id: string) => Promise<void>,
) {
  const rows = element('package-rows', HTMLTableSectionElement);
  const status = element('package-status', HTMLOutputElement);
  let generation = 0;
  const clear = () => {
    generation++;
    rows.replaceChildren();
    status.textContent = '';
  };
  for (const field of [repository, token]) field.addEventListener('input', clear);
  const select = <T extends string>(id: string, allowed: readonly T[], fallback: T): T => {
    const value = element(id, HTMLSelectElement).value;
    return allowed.find((item) => item === value) ?? fallback;
  };
  const add = (item: PackageResponse) => {
    const row = document.createElement('tr');
    for (const value of [item.group, item.name, item.version]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.className = 'secondary small';
    message(button, 'open');
    button.onclick = () => {
      run(() => open(item.artifactId));
    };
    action.append(button);
    row.append(action);
    rows.append(row);
  };
  const refresh = async () => {
    const current = ++generation;
    const repo = repository.value;
    const result = await client.packages(repo, {
      group: element('package-group', HTMLInputElement).value,
      name: element('package-name', HTMLInputElement).value,
      sort: select('package-sort', ['group', 'name', 'version'], 'group'),
      direction: select('package-direction', ['asc', 'desc'], 'asc'),
      groupBy: select('package-group-by', ['group', 'package', 'none'], 'group'),
    });
    if (current !== generation || repo !== repository.value) return;
    rows.replaceChildren();
    if (result.groups.length) {
      for (const group of result.groups) {
        const header = document.createElement('tr');
        header.className = 'group-row';
        const title = document.createElement('th');
        title.colSpan = 4;
        title.scope = 'rowgroup';
        title.textContent = group.name
          ? `${group.group || '—'} / ${group.name}`
          : group.group || '—';
        header.append(title);
        rows.append(header);
        for (const item of group.items) add(item);
      }
    } else for (const item of result.items) add(item);
    message(status, result.items.length ? 'packageCount' : 'noPackages', {
      count: result.items.length,
    });
  };
  element('package-filter', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(refresh);
  };
  document
    .querySelector<HTMLButtonElement>('[data-nav="packages"]')
    ?.addEventListener('click', () => {
      run(refresh);
    });
  return clear;
}

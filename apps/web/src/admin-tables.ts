import type { AccountResponse, GroupResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';

/** Shows the table or its empty hint, never both. */
export function tableState(rows: HTMLTableSectionElement) {
  const empty = element(`${rows.id}-empty`, HTMLParagraphElement);
  empty.hidden = rows.rows.length > 0;
  const table = rows.closest<HTMLElement>('.table');
  if (table) table.hidden = !empty.hidden;
}

/** Refills a select, keeping the choice, and disables its form until every select has options. */
export function options(id: string, values: readonly { id: string; name: string }[]) {
  const select = element(id, HTMLSelectElement);
  const before = select.value;
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value.id;
    option.textContent = value.name;
    select.append(option);
  }
  if (values.some((value) => value.id === before)) select.value = before;
  select.disabled = values.length === 0;
  const form = select.closest('form');
  if (form) {
    const unavailable = [...form.querySelectorAll('select')].some((field) => !field.options.length);
    for (const button of form.querySelectorAll('button')) button.disabled = unavailable;
  }
}

export function selectedName(id: string) {
  const select = element(id, HTMLSelectElement);
  return select.selectedOptions[0]?.textContent ?? select.value;
}

export function renderUsers(
  rows: HTMLTableSectionElement,
  accounts: readonly AccountResponse[],
  toggle: (account: AccountResponse) => void,
) {
  rows.replaceChildren(
    ...accounts.map((account) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = account.name;
      const role = document.createElement('td');
      if (account.administrator) message(role, 'administrator');
      else role.textContent = '—';
      const state = document.createElement('td');
      message(state, account.enabled ? 'enabled' : 'disabled');
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary small';
      message(button, account.enabled ? 'disableUser' : 'enableUser');
      button.onclick = () => {
        toggle(account);
      };
      action.append(button);
      row.append(name, role, state, action);
      return row;
    }),
  );
}

export function renderGroups(
  rows: HTMLTableSectionElement,
  groups: readonly GroupResponse[],
  accounts: readonly AccountResponse[],
) {
  rows.replaceChildren(
    ...groups.map((group) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = group.name;
      const members = document.createElement('td');
      members.textContent = group.members
        .map((id) => accounts.find((account) => account.id === id)?.name ?? id)
        .join(', ');
      const grants = document.createElement('td');
      for (const grant of group.grants) {
        const line = document.createElement('div');
        const repository = document.createElement('span');
        message(repository, 'grantRepository', { repository: grant.repository });
        const access = document.createElement('span');
        message(access, grant.access);
        line.append(repository, ' ', access);
        grants.append(line);
      }
      row.append(name, members, grants);
      return row;
    }),
  );
}

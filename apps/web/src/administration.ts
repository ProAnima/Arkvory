import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { AccountResponse, GroupResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';

// arkvory-exception ARCH-019 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installAdministration(
  client: ArkvoryClient,
  run: (action: () => Promise<void>) => void,
) {
  const nav = element('admin-nav', HTMLButtonElement);
  const rows = element('group-rows', HTMLTableSectionElement);
  const userRows = element('user-rows', HTMLTableSectionElement);
  const status = element('admin-status', HTMLOutputElement);
  let accounts: readonly AccountResponse[] = [];
  let groups: readonly GroupResponse[] = [];
  let generation = 0;
  const clear = () => {
    generation++;
    accounts = [];
    groups = [];
    nav.hidden = true;
    rows.replaceChildren();
    userRows.replaceChildren();
    status.textContent = '';
  };
  const options = (id: string, values: readonly { id: string; name: string }[]) => {
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
  };
  const refresh = async () => {
    const current = ++generation;
    const [nextAccounts, nextGroups] = await Promise.all([client.users(), client.accessGroups()]);
    if (current !== generation) return;
    accounts = nextAccounts;
    groups = nextGroups;
    options('member-group', groups);
    options('grant-group', groups);
    options('member-user', accounts);
    options('reset-user', accounts);
    userRows.replaceChildren();
    for (const account of accounts) {
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
      button.className = 'secondary small';
      message(button, account.enabled ? 'disableUser' : 'enableUser');
      button.onclick = () => {
        run(async () => {
          await client.updateUser(account.id, { enabled: !account.enabled });
          await refresh();
          message(status, 'accessSaved');
        });
      };
      action.append(button);
      row.append(name, role, state, action);
      userRows.append(row);
    }
    rows.replaceChildren();
    for (const group of groups) {
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
        repository.textContent = `${grant.repository}: `;
        const access = document.createElement('span');
        message(access, grant.access);
        line.append(repository, access);
        grants.append(line);
      }
      row.append(name, members, grants);
      rows.append(row);
    }
  };
  nav.addEventListener('click', () => {
    run(refresh);
  });
  element('create-user', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      await client.createUser(
        element('new-user-name', HTMLInputElement).value,
        element('new-user-password', HTMLInputElement).value,
        element('new-user-admin', HTMLInputElement).checked,
      );
      element('new-user-password', HTMLInputElement).value = '';
      await refresh();
      message(status, 'userCreated');
    });
  };
  element('create-group', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      await client.createAccessGroup(element('new-group-name', HTMLInputElement).value);
      element('new-group-name', HTMLInputElement).value = '';
      await refresh();
      message(status, 'groupCreated');
    });
  };
  element('reset-password', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      await client.updateUser(element('reset-user', HTMLSelectElement).value, {
        password: element('reset-password-value', HTMLInputElement).value,
      });
      element('reset-password-value', HTMLInputElement).value = '';
      await refresh();
      message(status, 'passwordChanged');
    });
  };
  const membership = (present: boolean) => {
    run(async () => {
      await client.setGroupMember(
        element('member-group', HTMLSelectElement).value,
        element('member-user', HTMLSelectElement).value,
        present,
      );
      await refresh();
      message(status, 'accessSaved');
    });
  };
  element('group-member', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    membership(true);
  };
  element('remove-member', HTMLButtonElement).onclick = () => {
    membership(false);
  };
  const grant = (present: boolean) => {
    run(async () => {
      const access = element('grant-access', HTMLSelectElement).value;
      if (access !== 'read' && access !== 'write') return;
      await client.setGroupGrant(
        element('grant-group', HTMLSelectElement).value,
        element('grant-repository', HTMLInputElement).value,
        present ? access : null,
      );
      await refresh();
      message(status, 'accessSaved');
    });
  };
  element('group-grant', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    grant(true);
  };
  element('remove-grant', HTMLButtonElement).onclick = () => {
    grant(false);
  };
  return {
    clear,
    refresh,
    show: () => {
      nav.hidden = false;
    },
  };
}

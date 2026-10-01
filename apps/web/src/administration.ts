import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { AccountResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { onViewOpen } from './shell.js';
import { confirmAction, dismissConfirmation } from './confirm-dialog.js';
import { options, renderGroups, renderUsers, selectedName, tableState } from './admin-tables.js';

const value = (id: string) => element(id, HTMLInputElement).value;
const choice = (id: string) => element(id, HTMLSelectElement).value;
const selects = ['member-group', 'grant-group', 'member-user', 'reset-user'] as const;

function onSubmit(id: string, action: () => void) {
  element(id, HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    action();
  };
}

export function installAdministration(
  client: ArkvoryClient,
  run: (action: () => Promise<void>) => void,
) {
  const nav = element('admin-nav', HTMLButtonElement);
  const rows = element('group-rows', HTMLTableSectionElement);
  const userRows = element('user-rows', HTMLTableSectionElement);
  const status = element('admin-status', HTMLOutputElement);
  let generation = 0;
  const clear = () => {
    generation++;
    dismissConfirmation();
    nav.hidden = true;
    rows.replaceChildren();
    userRows.replaceChildren();
    clearMessage(status);
    for (const id of selects) options(id, []);
  };
  const refresh = async () => {
    const current = ++generation;
    const [accounts, groups] = await Promise.all([client.users(), client.accessGroups()]);
    if (current !== generation) return;
    options('member-group', groups);
    options('grant-group', groups);
    options('member-user', accounts);
    options('reset-user', accounts);
    renderUsers(userRows, accounts, toggleUser);
    renderGroups(rows, groups, accounts);
    tableState(userRows);
    tableState(rows);
  };
  /** Destructive changes ask first; a declined confirmation leaves the forms untouched. */
  const change = (
    confirmation: [MessageKey, Record<string, string>, MessageKey] | undefined,
    action: () => Promise<void>,
    done: MessageKey,
  ) => {
    run(async () => {
      if (confirmation && !(await confirmAction(...confirmation))) return;
      await action();
      await refresh();
      message(status, done);
    });
  };
  const toggleUser = (account: AccountResponse) => {
    change(
      account.enabled ? ['confirmDisableUser', { name: account.name }, 'disableUser'] : undefined,
      () => client.updateUser(account.id, { enabled: !account.enabled }).then(() => undefined),
      'accessSaved',
    );
  };
  onViewOpen('administration', () => {
    run(refresh);
  });
  onSubmit('create-user', () => {
    change(
      undefined,
      async () => {
        await client.createUser(
          value('new-user-name'),
          value('new-user-password'),
          element('new-user-admin', HTMLInputElement).checked,
        );
        element('new-user-password', HTMLInputElement).value = '';
      },
      'userCreated',
    );
  });
  onSubmit('create-group', () => {
    change(
      undefined,
      async () => {
        await client.createAccessGroup(value('new-group-name'));
        element('new-group-name', HTMLInputElement).value = '';
      },
      'groupCreated',
    );
  });
  onSubmit('reset-password', () => {
    change(
      undefined,
      async () => {
        await client.updateUser(choice('reset-user'), { password: value('reset-password-value') });
        element('reset-password-value', HTMLInputElement).value = '';
      },
      'passwordChanged',
    );
  });
  installGroupForms(client, change);
  return {
    clear,
    refresh,
    show: () => {
      nav.hidden = false;
    },
  };
}

function installGroupForms(
  client: ArkvoryClient,
  change: (
    confirmation: [MessageKey, Record<string, string>, MessageKey] | undefined,
    action: () => Promise<void>,
    done: MessageKey,
  ) => void,
) {
  const membership = (present: boolean) => {
    change(
      present
        ? undefined
        : [
            'confirmRemoveMember',
            { user: selectedName('member-user'), group: selectedName('member-group') },
            'removeMember',
          ],
      () => client.setGroupMember(choice('member-group'), choice('member-user'), present),
      'accessSaved',
    );
  };
  onSubmit('group-member', () => {
    membership(true);
  });
  element('remove-member', HTMLButtonElement).onclick = () => {
    membership(false);
  };
  const grant = (present: boolean) => {
    const access = choice('grant-access');
    if (access !== 'read' && access !== 'write') return;
    if (!present && !element('grant-repository', HTMLInputElement).reportValidity()) return;
    change(
      present
        ? undefined
        : [
            'confirmRemoveGrant',
            { group: selectedName('grant-group'), repository: value('grant-repository') },
            'removeGrant',
          ],
      () =>
        client.setGroupGrant(
          choice('grant-group'),
          value('grant-repository'),
          present ? access : null,
        ),
      'accessSaved',
    );
  };
  onSubmit('group-grant', () => {
    grant(true);
  });
  element('remove-grant', HTMLButtonElement).onclick = () => {
    grant(false);
  };
}

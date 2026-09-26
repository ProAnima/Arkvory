import { requestCurrent } from './management-task.js';
import { administrationPermissionNames } from '@proanima/arkvory-contracts';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { BindingsEditor } from './bindings-editor.js';
import { command, disclosure, field, node, submit } from './management-dom.js';
import type { ManagementTask } from './management-task.js';
import type { ManagementDialogs } from './management-dialogs.js';
import type { Delegation } from './service-authority.js';
import { feedback } from './feedback.js';

export class ServiceDelegations {
  readonly root = node('section', undefined, 'management-stack');
  private readonly list = node('div', undefined, 'management-stack');
  private readonly form = node('form', undefined, 'management-stack');
  private readonly editor = disclosure('delegationNew');
  private readonly keyTitle = node('code');
  private readonly target = field('delegation-target', 'delegationTarget');
  private readonly ceiling = new BindingsEditor(16);
  private readonly checks = new Map<string, HTMLInputElement>();
  private records: readonly Delegation[] = [];
  private keyId = '';
  constructor(
    private readonly client: ArkvoryClient,
    private readonly task: ManagementTask,
    private readonly dialogs: ManagementDialogs,
    private readonly writable: boolean,
  ) {
    this.root.hidden = true;
    this.target.input.required = true;
    this.target.input.pattern = '[a-fA-F0-9-]{36}';
    const choices = node('fieldset', undefined, 'permission-grid');
    choices.append(node('legend', 'delegationActions'));
    for (const action of administrationPermissionNames) {
      const label = node('label', undefined, 'permission-choice'),
        input = node('input');
      input.type = 'checkbox';
      input.dataset['adminPermission'] = action;
      label.append(input, node('span', `permission.${action}`));
      choices.append(label);
      this.checks.set(action, input);
    }
    const controls = node('fieldset', undefined, 'management-stack');
    controls.disabled = !writable;
    controls.append(
      this.target.label,
      choices,
      node('h4', 'delegationCeiling'),
      this.ceiling.root,
      submit('delegationSave'),
    );
    this.form.append(controls);
    this.editor.append(this.form);
    this.form.onsubmit = (event) => {
      event.preventDefault();
      this.save();
    };
    this.target.input.onchange = () => {
      const record = this.records.find((d) => d.targetAccountId === this.target.input.value);
      if (record) this.edit(record);
    };
    this.root.append(
      node('h3', 'delegations'),
      this.keyTitle,
      node('p', 'delegationHint', 'hint'),
      this.list,
      this.editor,
    );
  }
  clear() {
    this.keyId = '';
    this.records = [];
    this.list.replaceChildren();
    this.edit();
    this.root.hidden = true;
  }
  async open(keyId: string, signal: AbortSignal) {
    const records = await this.client.serviceDelegations(keyId, signal);
    if (!requestCurrent(signal)) return;
    this.keyId = keyId;
    this.keyTitle.textContent = keyId;
    this.editor.open = false;
    this.records = records;
    this.root.hidden = false;
    this.list.replaceChildren();
    this.edit();
    for (const record of records) {
      const row = node('div', undefined, 'binding-row');
      const id = node('code');
      id.textContent = record.targetAccountId;
      row.append(
        id,
        node('span', record.enabled ? 'enabled' : 'disabled'),
        command('open', () => {
          this.edit(record);
          this.editor.open = true;
        }),
      );
      if (record.enabled && this.writable)
        row.append(
          command('delegationRemove', () => {
            this.task.run(async (current) => {
              if (
                !(await this.dialogs.confirm(record.targetAccountId, 'delegationHint', current)) ||
                current.aborted
              )
                return;
              await this.client.removeServiceDelegation(
                keyId,
                record.targetAccountId,
                record.revision,
                current,
              );
              await this.open(keyId, current);
            });
          }),
        );
      this.list.append(row);
    }
    if (!records.length) this.list.append(node('p', 'managementEmpty', 'hint'));
  }
  private edit(record?: Delegation) {
    this.target.input.value = record?.targetAccountId ?? '';
    for (const action of administrationPermissionNames) {
      const check = this.checks.get(action);
      if (check) check.checked = record?.actions.includes(action) ?? false;
    }
    this.ceiling.set(record?.ceiling ?? []);
  }
  private save() {
    this.task.run(async (signal) => {
      const target = this.target.input.value.trim(),
        key = this.keyId;
      const actions = administrationPermissionNames.filter((a) => this.checks.get(a)?.checked);
      const revision = this.records.find((d) => d.targetAccountId === target)?.revision ?? 0;
      await this.client.setServiceDelegation(
        key,
        target,
        revision,
        actions,
        this.ceiling.read(),
        signal,
      );
      if (!requestCurrent(signal)) return;
      await this.open(key, signal);
      if (requestCurrent(signal)) feedback(this.task.status, 'managementSaved', {}, 'success');
    });
  }
}

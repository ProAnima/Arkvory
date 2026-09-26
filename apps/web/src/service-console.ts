import { requestCurrent } from './management-task.js';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { ServiceAccountResponse } from '@proanima/arkvory-contracts';
import { BindingsEditor } from './bindings-editor.js';
import { command, disclosure, field, node, submit } from './management-dom.js';
import { ManagementTask } from './management-task.js';
import type { ManagementDialogs } from './management-dialogs.js';
import type { ServiceAuthority } from './service-authority.js';
import { ServiceKeys } from './service-keys.js';
import { dateMessage, message } from './i18n.js';
import { feedback } from './feedback.js';

export class ServiceConsole {
  private readonly task: ManagementTask;
  private readonly list = node('div', undefined, 'management-stack');
  private readonly selected = node('section', undefined, 'management-stack');
  private readonly title = node('h3');
  private readonly state = node('p');
  private readonly policy = new BindingsEditor();
  private readonly policyControls = node('fieldset', undefined, 'management-stack');
  private readonly toggle = command('serviceDisable', () => {
    this.changeEnabled();
  });
  private readonly next = command('managementMore', () => {
    this.task.run((signal) => this.load(signal, this.cursor ?? undefined));
  });
  private readonly auditRows = node('div', undefined, 'management-stack');
  private readonly auditMore = command('managementMore', () => {
    this.task.run((signal) => this.audit(signal, this.auditCursor));
  });
  private readonly auditSection = disclosure('serviceAudit');
  private readonly keys: ServiceKeys;
  private account: ServiceAccountResponse | undefined;
  private cursor: string | null = null;
  private auditCursor = '0';
  constructor(
    private readonly client: ArkvoryClient,
    controls: HTMLFieldSetElement,
    output: HTMLOutputElement,
    private readonly authority: ServiceAuthority,
    private readonly dialogs: ManagementDialogs,
  ) {
    this.task = new ManagementTask(controls, output);
    this.keys = new ServiceKeys(client, this.task, authority, dialogs);
    this.selected.hidden = true;
    this.selected.id = 'service-selected';
    this.list.id = 'service-account-list';
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      command('managementReload', () => {
        this.reload();
      }),
      this.next,
    );
    this.next.disabled = true;
    const selectedActions = node('div', undefined, 'management-actions');
    selectedActions.append(
      this.toggle,
      command('serviceRefresh', () => {
        this.refreshSelected();
      }),
    );
    this.selected.append(this.title, this.state, selectedActions);
    this.installPolicy();
    this.installAudit();
    this.selected.append(this.keys.root);
    controls.replaceChildren(actions, this.list, this.createForm(), this.selected);
    if (!authority.bootstrap) controls.prepend(node('p', 'serviceDelegated', 'hint'));
    if (authority.delegations.length) {
      const own = disclosure('delegationOwn');
      for (const grant of authority.delegations) {
        const row = node('p');
        row.textContent = `${grant.targetAccountId}: ${grant.actions.join(', ')}`;
        own.append(row, node('span', grant.enabled ? 'enabled' : 'disabled'));
      }
      controls.append(own);
    }
  }
  clear() {
    this.task.clear();
    this.dialogs.clear();
    this.account = undefined;
    this.keys.clear();
    this.selected.hidden = true;
    this.list.replaceChildren();
  }
  reload() {
    this.task.run((signal) => this.load(signal));
  }
  private createForm() {
    const details = disclosure('serviceCreate');
    details.hidden = !this.authority.bootstrap || !this.authority.writable;
    const form = node('form', undefined, 'management-stack'),
      name = field('service-create-name', 'serviceName'),
      bindings = new BindingsEditor();
    form.id = 'service-create-form';
    name.input.required = true;
    name.input.pattern = '[a-zA-Z0-9_.-]{3,64}';
    form.append(
      name.label,
      node('p', 'servicePolicyHint', 'hint'),
      bindings.root,
      submit('serviceCreate'),
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      this.task.run(async (signal) => {
        const result = await this.client.createServiceAccount(
          name.input.value.trim(),
          bindings.read(),
          signal,
        );
        if (!requestCurrent(signal)) return;
        form.reset();
        bindings.set([]);
        details.open = false;
        await this.load(signal);
        if (requestCurrent(signal)) await this.open(result, signal);
      });
    };
    details.append(form);
    return details;
  }
  private installPolicy() {
    const form = node('form', undefined, 'management-stack');
    form.id = 'service-policy-form';
    this.policyControls.append(this.policy.root, submit('servicePolicySave'));
    form.append(this.policyControls);
    form.onsubmit = (event) => {
      event.preventDefault();
      this.task.run(async (signal) => {
        if (!this.account) return;
        const updated = await this.client.setServicePolicy(
          this.account.id,
          this.account.revision,
          this.policy.read(),
          signal,
        );
        if (!requestCurrent(signal)) return;
        await this.open(updated, signal);
        if (requestCurrent(signal)) feedback(this.task.status, 'managementSaved', {}, 'success');
      });
    };
    const details = disclosure('servicePolicy');
    details.append(node('p', 'servicePolicyHint', 'hint'), form);
    this.selected.append(details);
  }
  private installAudit() {
    this.auditSection.append(
      command('managementReload', () => {
        this.task.run((signal) => this.audit(signal));
      }),
      this.auditRows,
      this.auditMore,
    );
    this.auditMore.disabled = true;
    this.selected.append(this.auditSection);
  }
  private async load(signal: AbortSignal, after?: string) {
    const result = await this.client.serviceAccounts(after, signal);
    if (!requestCurrent(signal)) return;
    this.cursor = result.next;
    this.next.disabled = !result.next;
    this.list.replaceChildren();
    for (const account of result.items) {
      const row = node('article', undefined, 'management-account');
      const name = node('strong');
      name.textContent = account.name;
      const open = command('open', () => {
        this.task.run((current) => this.open(account, current));
      });
      row.dataset['accountId'] = account.id;
      row.append(name, node('span', account.enabled ? 'enabled' : 'disabled'), open);
      this.list.append(row);
    }
    if (!result.items.length) this.list.append(node('p', 'managementEmpty', 'hint'));
  }
  private async open(account: ServiceAccountResponse, signal: AbortSignal) {
    this.account = account;
    this.title.textContent = account.name;
    this.title.tabIndex = -1;
    this.selected.hidden = false;
    this.title.focus();
    message(this.state, 'managementAccountInfo', { id: account.id, revision: account.revision });
    message(this.toggle, account.enabled ? 'serviceDisable' : 'serviceEnable');
    this.toggle.hidden =
      !this.authority.allows(account.id, 'service-account.manage') ||
      !this.authority.covers(account.id, account.bindings);
    this.policy.set(account.bindings);
    this.policyControls.disabled =
      !this.authority.allows(account.id, 'policy.manage') ||
      !this.authority.covers(account.id, account.bindings);
    this.auditRows.replaceChildren();
    this.auditCursor = '0';
    this.auditMore.disabled = true;
    this.auditSection.hidden = !this.authority.allows(account.id, 'service-audit.read');
    await this.keys.open(account, signal);
  }
  private refreshSelected() {
    this.task.run(async (signal) => {
      if (!this.account) return;
      const account = this.authority.allows(this.account.id, 'service-account.read')
        ? await this.client.serviceAccount(this.account.id, signal)
        : await this.client.servicePolicy(this.account.id, signal);
      if (requestCurrent(signal)) await this.open(account, signal);
    });
  }
  private changeEnabled() {
    this.task.run(async (signal) => {
      if (!this.account) return;
      const account = this.account;
      if (
        account.enabled &&
        !(await this.dialogs.confirm(account.name, 'serviceDisableHint', signal))
      )
        return;
      if (!requestCurrent(signal)) return;
      const updated = await this.client.updateServiceAccount(
        account.id,
        account.revision,
        !account.enabled,
        signal,
      );
      if (!requestCurrent(signal)) return;
      await this.load(signal);
      if (requestCurrent(signal)) await this.open(updated, signal);
    });
  }
  private async audit(signal: AbortSignal, after = '0') {
    if (!this.account) return;
    const records = await this.client.serviceAudit(this.account.id, after, signal);
    if (!requestCurrent(signal)) return;
    this.auditRows.replaceChildren();
    this.auditMore.disabled = records.length < 100;
    this.auditCursor = records.at(-1)?.sequence ?? after;
    for (const record of records) {
      const row = node('div', undefined, 'binding-row'),
        time = node('time'),
        detail = node('p');
      dateMessage(time, record.occurredAt);
      detail.textContent = `${record.action} · ${record.actor} · ${record.keyId ?? '—'}`;
      row.append(time, detail);
      this.auditRows.append(row);
    }
    if (!records.length) this.auditRows.append(node('p', 'managementEmpty', 'hint'));
  }
}

import { requestCurrent } from './management-task.js';
import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { ApiKeyResponse, ServiceAccountResponse } from '@proanima/arkvory-contracts';
import { BindingsEditor } from './bindings-editor.js';
import { command, disclosure, field, node, submit } from './management-dom.js';
import { dateMessage, message } from './i18n.js';
import type { ManagementTask } from './management-task.js';
import type { ManagementDialogs } from './management-dialogs.js';
import type { ServiceAuthority } from './service-authority.js';
import { ServiceDelegations } from './service-delegations.js';
import { feedback } from './feedback.js';

export class ServiceKeys {
  readonly root = node('section', undefined, 'management-stack');
  private readonly list = node('div', undefined, 'management-card-grid');
  private readonly form = node('form', undefined, 'management-stack');
  private readonly issue = disclosure('keyIssue');
  private readonly name = field('service-key-name', 'keyName');
  private readonly expiry = field('service-key-expiry', 'keyExpiry', 'datetime-local');
  private readonly bindings = new BindingsEditor(64, () => this.allowedBindings());
  private readonly next = command('managementMore', () => {
    this.task.run((signal) => this.load(signal, this.cursor ?? undefined));
  });
  private readonly delegation: ServiceDelegations;
  private readonly rotation = node('p', 'keyRotationHint', 'hint');
  private account: ServiceAccountResponse | undefined;
  private source: ApiKeyResponse | undefined;
  private cursor: string | null = null;
  private request: { fingerprint: string; id: string } | undefined;
  constructor(
    private readonly client: ArkvoryClient,
    private readonly task: ManagementTask,
    private readonly authority: ServiceAuthority,
    private readonly dialogs: ManagementDialogs,
  ) {
    this.delegation = new ServiceDelegations(client, task, dialogs, authority.writable);
    this.name.input.required = true;
    this.name.input.pattern = '[a-zA-Z0-9_.-]{3,64}';
    this.form.id = 'service-key-form';
    this.form.append(
      this.name.label,
      this.expiry.label,
      node('p', 'keyExpiryHint', 'hint'),
      this.bindings.root,
      this.rotation,
      node('p', 'keyRetryHint', 'hint'),
      submit('keyIssue'),
      command('keyNew', () => {
        this.resetIssue();
      }),
    );
    this.form.onsubmit = (event) => {
      event.preventDefault();
      this.submit();
    };
    this.issue.append(this.form);
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      command('managementReload', () => {
        this.task.run((signal) => this.load(signal));
      }),
      this.next,
    );
    this.root.append(
      node('h3', 'serviceKeys'),
      actions,
      this.list,
      this.issue,
      this.delegation.root,
    );
    this.root.hidden = true;
  }
  clear() {
    this.account = undefined;
    this.source = undefined;
    this.request = undefined;
    this.list.replaceChildren();
    this.bindings.set([]);
    this.form.reset();
    this.delegation.clear();
    this.root.hidden = true;
  }
  async open(account: ServiceAccountResponse, signal: AbortSignal) {
    this.clear();
    this.account = account;
    this.root.hidden =
      !this.authority.allows(account.id, 'credential.read') &&
      !this.authority.allows(account.id, 'credential.manage');
    this.issue.hidden = !this.authority.allows(account.id, 'credential.manage');
    this.resetIssue();
    if (!this.root.hidden) await this.load(signal);
  }
  private async load(signal: AbortSignal, after?: string) {
    if (!this.account || !this.authority.allows(this.account.id, 'credential.read')) return;
    const result = await this.client.serviceKeys(this.account.id, after, signal);
    if (!requestCurrent(signal)) return;
    this.cursor = result.next;
    this.next.disabled = !result.next;
    this.list.replaceChildren();
    for (const key of result.items) this.list.append(this.row(key));
    if (!result.items.length) this.list.append(node('p', 'managementEmpty', 'hint'));
  }
  private row(key: ApiKeyResponse) {
    const row = node('article', undefined, 'binding-row');
    row.dataset['keyId'] = key.id;
    const title = node('h4');
    title.textContent = key.name;
    const expired =
      Date.parse(key.expiresAt) <= Date.now() ||
      (key.state === 'pending' && Date.parse(key.activationExpiresAt) <= Date.now());
    const state = node(
      'span',
      key.state === 'revoked'
        ? 'keyRevoked'
        : expired
          ? 'keyExpired'
          : key.state === 'active'
            ? 'keyActive'
            : 'keyPending',
    );
    const time = node('time');
    dateMessage(time, key.expiresAt);
    const details = disclosure('keyDetails'),
      id = node('code');
    id.textContent = key.id;
    details.append(id);
    for (const binding of key.bindings) {
      const line = node('p');
      message(line, 'keyBindingLine', {
        repository: binding.resource.id,
        actions: binding.actions.join(', '),
      });
      details.append(line);
    }
    const actions = node('div', undefined, 'management-actions');
    if (
      this.authority.allows(key.accountId, 'credential.manage') &&
      this.authority.covers(key.accountId, key.bindings) &&
      key.state !== 'revoked'
    ) {
      if (!expired)
        actions.append(
          command('keyRotate', () => {
            this.rotate(key);
          }),
        );
      actions.append(
        command('keyRevoke', () => {
          this.task.run(async (signal) => {
            if (
              !(await this.dialogs.confirm(key.name, 'keyRevokeHint', signal)) ||
              !requestCurrent(signal)
            )
              return;
            await this.client.revokeServiceKey(key.id, signal);
            if (requestCurrent(signal)) {
              await this.load(signal);
              if (requestCurrent(signal))
                feedback(this.task.status, 'managementSaved', {}, 'success');
            }
          });
        }),
      );
    }
    if (this.authority.bootstrap)
      actions.append(
        command('delegations', () => {
          this.task.run((signal) => this.delegation.open(key.id, signal));
        }),
      );
    const expiry = node('p', undefined, 'hint');
    expiry.append(node('span', 'keyExpires'), document.createTextNode(' · '), time);
    row.append(title, state, expiry, details, actions);
    return row;
  }
  private rotate(key: ApiKeyResponse) {
    this.source = key;
    this.request = undefined;
    this.bindings.set(key.bindings);
    this.name.input.value = `${key.name.slice(0, 59)}-next`;
    this.expiry.input.value = '';
    this.rotation.hidden = false;
    this.issue.open = true;
    message(this.issue.querySelector('summary') ?? this.rotation, 'keyRotate');
    this.name.input.focus();
  }
  private allowedBindings() {
    const account = this.account;
    if (!account) return [];
    return (this.source?.bindings ?? account.bindings)
      .map((binding) => ({
        resource: binding.resource,
        actions: binding.actions.filter(
          (action) =>
            account.bindings.some(
              (policy) =>
                policy.resource.id === binding.resource.id && policy.actions.includes(action),
            ) &&
            this.authority.covers(account.id, [{ resource: binding.resource, actions: [action] }]),
        ),
      }))
      .filter((binding) => binding.actions.length > 0);
  }
  private resetIssue() {
    this.source = undefined;
    this.request = undefined;
    this.form.reset();
    this.rotation.hidden = true;
    message(this.issue.querySelector('summary') ?? this.rotation, 'keyIssue');
    this.bindings.set(this.account?.bindings ?? []);
  }
  private submit() {
    this.task.run(async (signal) => {
      if (!this.account) return;
      const options = {
        name: this.name.input.value.trim(),
        bindings: this.bindings.read(),
        ...(this.expiry.input.value
          ? { expiresAt: new Date(this.expiry.input.value).toISOString() }
          : {}),
      };
      const fingerprint = JSON.stringify([this.account.id, this.source?.id, options]);
      if (this.request?.fingerprint !== fingerprint)
        this.request = { fingerprint, id: crypto.randomUUID() };
      const result = this.source
        ? await this.client.rotateServiceKey(this.source.id, this.request.id, options, signal)
        : await this.client.issueServiceKey(this.account.id, this.request.id, options, signal);
      if (!requestCurrent(signal)) return;
      this.request = undefined;
      this.source = undefined;
      this.form.reset();
      this.issue.open = false;
      this.rotation.hidden = true;
      message(this.issue.querySelector('summary') ?? this.rotation, 'keyIssue');
      this.bindings.set(this.account.bindings);
      if (result.secret)
        this.dialogs.showSecret(result.secret, () => {
          this.task.run((current) => this.load(current));
        });
      else feedback(this.task.status, 'keySecretMissing', {}, 'error');
      await this.load(signal);
    });
  }
}

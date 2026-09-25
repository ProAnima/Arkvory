import { DepotClient } from '@proanima/depot-sdk';
import type { OperationDescriptor } from '@proanima/depot-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';
import { feedback, errorKey, UiError } from './feedback.js';

export function initializeGuides() {
  const token = element('token', HTMLInputElement);
  const repository = element('repository', HTMLInputElement);
  const base =
    document.querySelector<HTMLMetaElement>('meta[name="depot-api-base-url"]')?.content.trim() ||
    location.origin;
  const client = new DepotClient(base, () => token.value);
  const list = element('help-operations', HTMLDivElement);
  const search = element('help-search', HTMLInputElement);
  const status = element('help-status', HTMLOutputElement);
  const load = element('help-load', HTMLButtonElement);
  let operations: readonly OperationDescriptor[] = [];
  let generation = 0;
  let pending: AbortController | undefined;
  const reset = () => {
    generation++;
    pending?.abort();
    operations = [];
    list.replaceChildren();
    status.textContent = '';
    delete status.dataset['i18n'];
    load.disabled = false;
  };
  const render = () => {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    for (const operation of operations.filter((item) =>
      [item.method, item.path, item.operationId, item.summary, item.surface]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )) {
      const card = document.createElement('details');
      card.className = 'guide-operation';
      const summary = document.createElement('summary');
      summary.textContent = `${operation.method.toUpperCase()} ${operation.path}`;
      const description = document.createElement('p');
      description.textContent = operation.summary;
      const identity = document.createElement('code');
      identity.textContent = `${operation.operationId} · ${operation.surface} · ${operation.visibility}`;
      const retry = document.createElement('p');
      const retryLabel = document.createElement('strong');
      message(retryLabel, 'helpRetry');
      retry.append(retryLabel, `: ${operation.retry}`);
      const actions = document.createElement('p');
      const actionsLabel = document.createElement('strong');
      message(actionsLabel, 'helpActions');
      actions.append(actionsLabel, `: ${operation.requiredActions.join(', ') || '—'}`);
      card.append(summary, description, identity, retry, actions);
      list.append(card);
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p');
      message(empty, 'helpEmpty');
      list.append(empty);
    }
  };
  search.addEventListener('input', render);
  load.onclick = () => {
    reset();
    const current = generation;
    const controller = new AbortController();
    pending = controller;
    load.disabled = true;
    void (async () => {
      const result: OperationDescriptor[] = [];
      let after: string | undefined;
      do {
        const page = await client.operations(
          { repository: repository.value, limit: 100, ...(after ? { after } : {}) },
          controller.signal,
        );
        if (current !== generation) return;
        result.push(...page.items);
        if (result.length > 2000 || (page.next && after && page.next <= after))
          throw new Error('Invalid operation pagination');
        after = page.next ?? undefined;
      } while (after);
      operations = result;
      render();
      message(status, 'helpLoaded', { count: result.length });
    })()
      .catch((error: unknown) => {
        if (current === generation) feedback(status, errorKey(error), {}, 'error');
      })
      .finally(() => {
        if (current === generation) load.disabled = false;
      });
  };
  for (const input of [token, repository]) input.addEventListener('input', reset);
  for (const id of ['connect', 'login', 'change-password'])
    element(id, HTMLFormElement).addEventListener('submit', reset, true);
  element('logout', HTMLButtonElement).addEventListener('click', reset, true);
  element('welcome-sign-in', HTMLButtonElement).onclick = () => {
    element('connection-card', HTMLDetailsElement).open = true;
    element('password-login', HTMLDetailsElement).open = true;
    element('login-name', HTMLInputElement).focus();
  };
  installOwnerForm(base);
}

function installOwnerForm(base: string) {
  const form = element('welcome-owner-form', HTMLFormElement);
  const status = element('welcome-status', HTMLOutputElement);
  form.onsubmit = (event) => {
    event.preventDefault();
    const secret = element('welcome-key', HTMLInputElement);
    const password = element('welcome-password', HTMLInputElement);
    const name = element('welcome-name', HTMLInputElement);
    const submit = element('welcome-create', HTMLButtonElement);
    const credential = secret.value;
    const desiredPassword = password.value;
    const desiredName = name.value;
    secret.value = '';
    password.value = '';
    submit.disabled = true;
    const client = new DepotClient(base, () => credential);
    void (async () => {
      if ((await client.users()).length > 0) throw new UiError('errorConflict');
      await client.createUser(desiredName, desiredPassword, true);
      message(status, 'welcomeCreated');
      element('login-name', HTMLInputElement).value = desiredName;
    })()
      .catch((error: unknown) => {
        feedback(status, errorKey(error), {}, 'error');
      })
      .finally(() => {
        submit.disabled = false;
      });
  };
}

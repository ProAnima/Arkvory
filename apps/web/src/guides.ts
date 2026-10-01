import { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { OperationDescriptor } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback, errorKey, UiError } from './feedback.js';

function labelledValue(label: 'helpRetry' | 'helpActions', value: string) {
  const line = document.createElement('p');
  const caption = document.createElement('strong');
  const content = document.createElement('span');
  message(caption, label);
  content.textContent = value;
  line.append(caption, ' ', content);
  return line;
}

/** The API help changes its hint with the connection instead of asking to sign in again. */
export function showGuideConnection(connected: boolean) {
  message(element('help-hint', HTMLParagraphElement), connected ? 'helpHintConnected' : 'helpHint');
}

function operationCard(operation: OperationDescriptor) {
  const card = document.createElement('details');
  card.className = 'guide-operation';
  const summary = document.createElement('summary');
  message(summary, 'helpOperationTitle', {
    method: operation.method.toUpperCase(),
    path: operation.path,
  });
  const description = document.createElement('p');
  description.textContent = operation.summary;
  const identity = document.createElement('code');
  message(identity, 'helpOperationIdentity', {
    id: operation.operationId,
    surface: operation.surface,
    visibility: operation.visibility,
  });
  const retry = labelledValue('helpRetry', operation.retry);
  const actions = labelledValue('helpActions', operation.requiredActions.join(', ') || '—');
  card.append(summary, description, identity, retry, actions);
  return card;
}

export function initializeGuides() {
  const token = element('token', HTMLInputElement);
  const repository = element('repository', HTMLInputElement);
  const base =
    document.querySelector<HTMLMetaElement>('meta[name="arkvory-api-base-url"]')?.content.trim() ||
    location.origin;
  const client = new ArkvoryClient(base, () => token.value);
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
    clearMessage(status);
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
    ))
      list.append(operationCard(operation));
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
    element('register', HTMLFormElement).hidden = true;
    element('login', HTMLFormElement).hidden = false;
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
    const client = new ArkvoryClient(base, () => credential);
    void (async () => {
      if ((await client.users()).length > 0) throw new UiError('errorConflict');
      const owner = await client.createUser(desiredName, desiredPassword, true);
      try {
        const group = await client.createAccessGroup('arkvory-owners');
        await client.setGroupGrant(group.id, 'releases', 'write');
        await client.setGroupMember(group.id, owner.id, true);
      } catch {
        throw new UiError('welcomePartial');
      }
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

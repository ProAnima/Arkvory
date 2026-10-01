import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { UserTokenResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, dateMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { tokenLifetime, tokenRequest, tokenScopeChoice, tokenState } from './user-token-model.js';

const stateKeys = {
  active: 'tokenActive',
  revoked: 'tokenRevokedState',
  expired: 'tokenExpired',
} as const satisfies Record<string, MessageKey>;

function cell(key?: MessageKey): HTMLTableCellElement {
  const td = document.createElement('td');
  if (key) message(td, key);
  return td;
}
function dateCell(value: string | null, empty: MessageKey): HTMLTableCellElement {
  const td = cell();
  if (value) dateMessage(td, value);
  else message(td, empty);
  return td;
}
function button(key: MessageKey, className: string, onclick: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = className;
  message(result, key);
  result.onclick = onclick;
  return result;
}

/** Two-step revoke inside the row: the first click only asks, the second revokes. */
function revokeControl(
  token: UserTokenResponse,
  action: HTMLTableCellElement,
  revoke: () => void,
): HTMLButtonElement {
  return button('revokeToken', 'secondary small', () => {
    const prompt = document.createElement('span');
    message(prompt, 'tokenRevokeConfirm', { name: token.name });
    const confirm = button('tokenRevokeConfirmSubmit', 'primary small', revoke);
    const cancel = button('tokenRevokeCancel', 'secondary small', () => {
      action.replaceChildren(revokeControl(token, action, revoke));
    });
    action.replaceChildren(prompt, confirm, cancel);
    confirm.focus();
  });
}

function tokenRow(token: UserTokenResponse, now: number, revoke: () => void) {
  const tr = document.createElement('tr');
  const name = cell();
  name.textContent = token.name;
  const prefix = cell();
  prefix.className = 'mono';
  prefix.textContent = token.prefix;
  const state = tokenState(token, now);
  const action = cell();
  if (state === 'active') action.append(revokeControl(token, action, revoke));
  tr.append(
    name,
    prefix,
    cell(token.scope === 'read' ? 'tokenScopeRead' : 'tokenScopeReadWrite'),
    dateCell(token.createdAt, 'tokenNoExpiry'),
    dateCell(token.expiresAt, 'tokenNoExpiry'),
    dateCell(token.lastUsedAt, 'tokenNeverUsed'),
    cell(stateKeys[state]),
    action,
  );
  return tr;
}

function installCopy(value: HTMLInputElement, copy: HTMLButtonElement, status: HTMLOutputElement) {
  copy.onclick = async () => {
    if (!value.value) return;
    try {
      await navigator.clipboard.writeText(value.value);
      message(status, 'tokenCopied');
    } catch {
      // Clipboard access can be denied; leave the secret selected for a manual copy.
      value.select();
      message(status, 'tokenCopyFailed');
    }
  };
}

export function installUserTokens(
  client: ArkvoryClient,
  run: (action: () => Promise<void>) => void,
) {
  const panel = element('personal-tokens', HTMLDetailsElement);
  const form = element('create-token-form', HTMLFormElement);
  const nameInput = element('new-token-name', HTMLInputElement);
  const expiry = element('new-token-expiry', HTMLSelectElement);
  const scope = element('new-token-scope', HTMLSelectElement);
  const resultCard = element('new-token-result', HTMLDivElement);
  const resultValue = element('created-token-value', HTMLInputElement);
  const copyStatus = element('copy-token-status', HTMLOutputElement);
  const rows = element('user-token-rows', HTMLTableSectionElement);
  const emptyHint = element('user-tokens-empty', HTMLParagraphElement);
  installCopy(resultValue, element('copy-token-button', HTMLButtonElement), copyStatus);

  const refresh = async () => {
    let tokens: readonly UserTokenResponse[];
    try {
      tokens = await client.tokens();
    } catch {
      // A revoked session or a non-session credential has no token list to show.
      rows.replaceChildren();
      return;
    }
    const now = Date.now();
    emptyHint.hidden = tokens.length > 0;
    rows.replaceChildren(
      ...tokens.map((token) =>
        tokenRow(token, now, () => {
          run(async () => {
            await client.revokeToken(token.id);
            await refresh();
          });
        }),
      ),
    );
  };

  form.onsubmit = (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const request = tokenRequest(
      tokenLifetime(expiry.value),
      tokenScopeChoice(scope.value),
      Date.now(),
    );
    run(async () => {
      const created = await client.createToken(name, request);
      nameInput.value = '';
      resultValue.value = created.token;
      clearMessage(copyStatus);
      resultCard.hidden = false;
      await refresh();
    });
  };

  return {
    show() {
      panel.hidden = false;
      resultCard.hidden = true;
      resultValue.value = '';
    },
    hide() {
      panel.hidden = true;
      panel.open = false;
      resultCard.hidden = true;
      resultValue.value = '';
      rows.replaceChildren();
    },
    refresh,
  };
}

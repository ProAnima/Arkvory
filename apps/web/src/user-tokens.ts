import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { UserTokenResponse } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';

export function installUserTokens(
  client: ArkvoryClient,
  run: (action: () => Promise<void>) => void,
) {
  const panel = element('personal-tokens', HTMLDetailsElement);
  const form = element('create-token-form', HTMLFormElement);
  const nameInput = element('new-token-name', HTMLInputElement);
  const resultCard = element('new-token-result', HTMLDivElement);
  const resultValue = element('created-token-value', HTMLInputElement);
  const copyButton = element('copy-token-button', HTMLButtonElement);
  const rows = element('user-token-rows', HTMLTableSectionElement);
  const emptyHint = element('user-tokens-empty', HTMLParagraphElement);

  copyButton.onclick = async () => {
    if (!resultValue.value) return;
    await navigator.clipboard.writeText(resultValue.value).catch(() => undefined);
    message(copyButton, 'tokenCopied');
    setTimeout(() => {
      message(copyButton, 'copyToken');
    }, 2000);
  };

  const render = (tokens: readonly UserTokenResponse[]) => {
    rows.replaceChildren();
    emptyHint.hidden = tokens.length > 0;
    for (const token of tokens) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = token.name;
      const prefix = document.createElement('td');
      prefix.className = 'mono';
      prefix.textContent = token.prefix;
      const created = document.createElement('td');
      created.textContent = new Date(token.createdAt).toLocaleDateString();
      const used = document.createElement('td');
      used.textContent = token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : '—';
      const action = document.createElement('td');
      const revoke = document.createElement('button');
      revoke.className = 'secondary small';
      message(revoke, 'revokeToken');
      revoke.disabled = token.revoked;
      revoke.onclick = () => {
        run(async () => {
          await client.revokeToken(token.id);
          await refresh();
        });
      };
      action.append(revoke);
      tr.append(name, prefix, created, used, action);
      rows.append(tr);
    }
  };

  const refresh = async () => {
    try {
      const tokens = await client.tokens();
      render(tokens);
    } catch {
      // Ignored if unauthenticated or revoked
    }
  };

  form.onsubmit = (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    run(async () => {
      const created = await client.createToken(name);
      nameInput.value = '';
      resultValue.value = created.token;
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

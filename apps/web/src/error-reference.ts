import { message } from './i18n.js';

/**
 * The quiet line under an error: "Try again in N s" and the selectable request ID. It sits
 * right after its message node (`.error-ref`), so CSS hides it with an empty message and no
 * caller has to keep two nodes in sync. The global status bar uses the static #request-id.
 */
function referenceNode(node: HTMLElement, create: boolean): HTMLElement | undefined {
  const next = node.nextElementSibling;
  if (next instanceof HTMLElement && next.classList.contains('error-ref')) return next;
  if (!create) return undefined;
  const reference = document.createElement('span');
  reference.className = 'error-ref';
  node.after(reference);
  return reference;
}

export function clearReference(node: HTMLElement) {
  const reference = referenceNode(node, false);
  if (!reference) return;
  reference.replaceChildren();
  delete reference.dataset['reference'];
}

export function showReference(
  node: HTMLElement,
  reference: { readonly requestId?: string; readonly retryAfterSeconds?: number },
) {
  if (reference.requestId === undefined && reference.retryAfterSeconds === undefined) {
    clearReference(node);
    return;
  }
  const line = referenceNode(node, true);
  if (!line) return;
  // Re-rendered rows repeat the same failure; keep the nodes so a selection survives.
  const signature = `${reference.requestId ?? ''} ${String(reference.retryAfterSeconds ?? '')}`;
  if (line.childElementCount && line.dataset['reference'] === signature) return;
  line.dataset['reference'] = signature;
  const parts: HTMLElement[] = [];
  if (reference.retryAfterSeconds !== undefined) {
    const retry = document.createElement('span');
    retry.className = 'error-ref-retry';
    message(retry, 'retryIn', { seconds: reference.retryAfterSeconds });
    parts.push(retry);
  }
  if (reference.requestId !== undefined) {
    const label = document.createElement('span');
    message(label, 'requestIdLabel');
    // One click selects the whole ID for copying; it is server data, never translated.
    const value = document.createElement('code');
    value.className = 'request-id-value';
    value.tabIndex = 0;
    value.textContent = reference.requestId;
    const id = document.createElement('span');
    id.className = 'error-ref-id';
    id.append(label, value);
    parts.push(id);
  }
  line.replaceChildren(...parts);
}

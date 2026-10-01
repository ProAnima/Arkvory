import type { MessageKey } from './messages.js';
import { message } from './i18n.js';
import { describeError, errorReference } from './error-keys.js';
import type { Credential } from './error-keys.js';
import { clearReference, showReference } from './error-reference.js';
export { UiError } from './error-keys.js';
export type { Credential } from './error-keys.js';
// The page has exactly one active credential; 401 wording depends on how it was obtained.
let credential: Credential = 'none';
export function describeCredential(next: Credential) {
  credential = next;
}
export function errorKey(error: unknown): MessageKey {
  return describeError(error, credential);
}
/** Any new message replaces the previous error reference of the same node. */
export function feedback(
  node: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
  tone: 'info' | 'success' | 'error' = 'info',
) {
  if (node.id === 'status' && node.parentElement) node.parentElement.hidden = false;
  node.dataset['tone'] = tone;
  message(node, key, params);
  clearReference(node);
}
/** The one way to show a failure: localized text plus request ID and Retry-After if known. */
export function showFailure(node: HTMLElement, error: unknown, key = errorKey(error)) {
  feedback(node, key, {}, 'error');
  showReference(node, errorReference(error));
}

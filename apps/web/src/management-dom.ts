import { message } from './i18n.js';
import type { MessageKey } from './messages.js';

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key?: MessageKey,
  className?: string,
) {
  const result = document.createElement(tag);
  if (key) message(result, key);
  if (className) result.className = className;
  return result;
}
/** Secondary explanation rendered as a localized tooltip; `label` names its trigger button. */
export function helpText(key: MessageKey, label: MessageKey) {
  const result = node('p', key, 'hint');
  result.dataset['help'] = label;
  return result;
}
export function command(key: MessageKey, action: () => void, className = 'secondary') {
  const result = node('button', key, className);
  result.type = 'button';
  result.onclick = action;
  return result;
}
export function field(id: string, key: MessageKey, type = 'text') {
  const label = node('label');
  const input = node('input');
  input.id = id;
  input.type = type;
  label.append(node('span', key), input);
  return { label, input };
}
export function disclosure(key: MessageKey) {
  const result = node('details', undefined, 'disclosure');
  result.append(node('summary', key));
  return result;
}
export function submit(key: MessageKey) {
  const result = node('button', key, 'primary');
  result.type = 'submit';
  return result;
}

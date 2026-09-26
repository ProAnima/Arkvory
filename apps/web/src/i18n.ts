import { isMessageKey, translate } from './messages.js';
import type { MessageKey, Language } from './messages.js';
import { languagePreference, readPreference, savePreference } from './preferences.js';
let language: Language = languagePreference(readPreference('language'), navigator.language);
function text(node: HTMLElement, value: string) {
  // Progress updates must not replace unchanged live-region text or disturb text selection.
  if (node.textContent !== value) node.textContent = value;
}
function attribute(node: HTMLElement, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}) {
  return translate(language, key, params);
}
function render(node: HTMLElement) {
  const key = node.dataset['i18n'];
  if (key && isMessageKey(key)) {
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.dataset))
      if (name.startsWith('param') && value !== undefined)
        params[name.slice(5).toLowerCase()] = value;
    text(node, t(key, params));
  }
  for (const [data, name] of [
    ['i18nPlaceholder', 'placeholder'],
    ['i18nLabel', 'aria-label'],
  ] as const) {
    const value = node.dataset[data];
    if (value && isMessageKey(value)) attribute(node, name, t(value));
  }
  const date = node.dataset['date'];
  if (date)
    text(
      node,
      new Intl.DateTimeFormat(language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(date)),
    );
}
export function message(
  node: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
) {
  const parameters = Object.entries(params).map(
    ([name, value]) =>
      [`param${name.charAt(0).toUpperCase()}${name.slice(1)}`, String(value)] as const,
  );
  for (const name of Object.keys(node.dataset))
    if (name.startsWith('param') && !parameters.some(([current]) => current === name))
      Reflect.deleteProperty(node.dataset, name);
  attribute(node, 'data-i18n', key);
  for (const [name, value] of parameters)
    if (node.dataset[name] !== value) node.dataset[name] = value;
  render(node);
}
export function dateMessage(node: HTMLElement, date: string) {
  attribute(node, 'data-date', date);
  render(node);
}
export function setLanguage(value: Language) {
  language = value;
  document.documentElement.lang = language;
  for (const node of document.querySelectorAll<HTMLElement>(
    '[data-i18n], [data-i18n-placeholder], [data-i18n-label], [data-date]',
  ))
    render(node);
  savePreference('language', language);
}
export function initializeLanguage() {
  setLanguage(language);
  return language;
}

import { isMessageKey, translate } from './messages.js';
import type { MessageKey, Language } from './messages.js';
import { languagePreference, readPreference, savePreference } from './preferences.js';
let language: Language = languagePreference(readPreference('language'), navigator.language);
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
    node.textContent = t(key, params);
  }
  for (const [data, attribute] of [
    ['i18nPlaceholder', 'placeholder'],
    ['i18nLabel', 'aria-label'],
  ] as const) {
    const value = node.dataset[data];
    if (value && isMessageKey(value)) node.setAttribute(attribute, t(value));
  }
  const date = node.dataset['date'];
  if (date)
    node.textContent = new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(date));
}
export function message(
  node: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
) {
  for (const attribute of Array.from(node.attributes))
    if (attribute.name.startsWith('data-param-')) node.removeAttribute(attribute.name);
  node.dataset['i18n'] = key;
  for (const [name, value] of Object.entries(params))
    node.dataset[`param${name.charAt(0).toUpperCase()}${name.slice(1)}`] = String(value);
  render(node);
}
export function dateMessage(node: HTMLElement, date: string) {
  node.dataset['date'] = date;
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

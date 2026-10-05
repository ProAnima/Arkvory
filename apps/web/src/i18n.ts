import { en, ru, dictionaryFrom, isMessageKey, translate } from './messages.js';
import type { Dictionary, MessageKey } from './messages.js';
import { directionOf, intlOf, type Language } from './languages.js';
import { languagePreference, readPreference, savePreference } from './preferences.js';
import { presentAction } from './action-presentation.js';
import { relativeParts } from './relative-time.js';
let language: Language = languagePreference(readPreference('language'), navigator.languages);
// English and Russian are in the bundle; another language is fetched once, when first chosen.
const dictionaries = new Map<Language, Dictionary>([
  ['en', en],
  ['ru', ru],
]);
let dictionary: Dictionary = dictionaries.get(language) ?? en;
let requests = 0;
const listeners = new Set<() => void>();
/** Called whenever the page takes another language (the language switch redraws itself). */
export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
}
/** The documentation site; English at its root, another language in its own folder. */
const DOCUMENTATION = 'https://proanima.github.io/Arkvory/';
export function documentationUrl(value: Language, page = '') {
  return `${DOCUMENTATION}${value === 'en' ? '' : `${value}/`}${page}`;
}
function text(node: HTMLElement, value: string) {
  // Progress updates must not replace unchanged live-region text or disturb text selection.
  if (node.textContent !== value) node.textContent = value;
}
function attribute(node: HTMLElement, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}) {
  return translate(dictionary, key, params);
}
function render(node: HTMLElement) {
  const key = node.dataset['i18n'];
  if (key && isMessageKey(key)) {
    const params: Record<string, string> = {};
    // Byte counts and times stay exact in data attributes and are formatted for the current
    // language, where its sentence puts them.
    const sizes = new Set((node.dataset['byteParams'] ?? '').split(',').filter(Boolean));
    const dates = new Set((node.dataset['dateParams'] ?? '').split(',').filter(Boolean));
    for (const [name, value] of Object.entries(node.dataset))
      if (name.startsWith('param') && value !== undefined) {
        const param = name.slice(5).toLowerCase();
        params[param] = sizes.has(param)
          ? formatBytes(language, Number(value))
          : dates.has(param)
            ? formatDate(new Date(value), undefined)
            : value;
      }
    const value = t(key, params);
    if (!presentAction(node, key, value)) text(node, value);
  }
  for (const [data, name] of [
    ['i18nPlaceholder', 'placeholder'],
    ['i18nLabel', 'aria-label'],
  ] as const) {
    const value = node.dataset[data];
    if (value && isMessageKey(value)) attribute(node, name, t(value));
  }
  // A link to a page of the documentation opens it in the console's language.
  const page = node.dataset['docs'];
  if (page !== undefined) attribute(node, 'href', documentationUrl(language, page));
  const bytes = node.dataset['bytes'];
  if (bytes) text(node, formatBytes(language, Number(bytes)));
  const date = node.dataset['date'];
  if (date) text(node, formatDate(new Date(date), node.dataset['dateZone']));
  const relative = node.dataset['relative'];
  if (relative) {
    // The age is computed at render time; the exact local time stays available on hover.
    const at = new Date(relative);
    const { value, unit } = relativeParts(at.getTime(), Date.now());
    text(
      node,
      new Intl.RelativeTimeFormat(intlOf(language), { numeric: 'auto' }).format(value, unit),
    );
    attribute(node, 'title', formatDate(at, undefined));
  }
}
/** Local medium date and short time; an explicit zone (e.g. UTC) is named in the text. */
function formatDate(date: Date, zone: string | undefined) {
  const options: Intl.DateTimeFormatOptions = zone
    ? {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short',
      }
    : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(intlOf(language), options).format(date);
}
export function message(
  node: HTMLElement,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
  byteParams: readonly string[] = [],
  dateParams: readonly string[] = [],
) {
  const parameters = Object.entries(params).map(
    ([name, value]) =>
      [`param${name.charAt(0).toUpperCase()}${name.slice(1)}`, String(value)] as const,
  );
  for (const name of Object.keys(node.dataset))
    if (name.startsWith('param') && !parameters.some(([current]) => current === name))
      Reflect.deleteProperty(node.dataset, name);
  attribute(node, 'data-i18n', key);
  const sizes = byteParams.map((name) => name.toLowerCase()).join(',');
  if (sizes) attribute(node, 'data-byte-params', sizes);
  else node.removeAttribute('data-byte-params');
  const dates = dateParams.map((name) => name.toLowerCase()).join(',');
  if (dates) attribute(node, 'data-date-params', dates);
  else node.removeAttribute('data-date-params');
  for (const [name, value] of parameters)
    if (node.dataset[name] !== value) node.dataset[name] = value;
  render(node);
}
/** Binary units with locale digits; values stay exact in data-bytes for language switches. */
export function formatBytes(locale: Language, value: number): string {
  const units = ['sizeBytes', 'sizeKiB', 'sizeMiB', 'sizeGiB', 'sizeTiB'] as const;
  let size = value,
    unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : size < 10 ? 2 : 1;
  const formatted = new Intl.NumberFormat(intlOf(locale), { maximumFractionDigits: digits }).format(
    size,
  );
  return translate(dictionaries.get(locale) ?? en, units[unit] ?? 'sizeBytes', {
    value: formatted,
  });
}
export function bytesMessage(node: HTMLElement, bytes: number | string) {
  attribute(node, 'data-bytes', String(bytes));
  render(node);
}
export function dateMessage(node: HTMLElement, date: string, zone?: string) {
  attribute(node, 'data-date', date);
  if (zone) attribute(node, 'data-date-zone', zone);
  else node.removeAttribute('data-date-zone');
  render(node);
}
/** "5 minutes ago" in the current language, with the exact local time as the hover title. */
export function relativeMessage(node: HTMLElement, date: string) {
  attribute(node, 'data-relative', date);
  render(node);
}
export function clearMessage(node: HTMLElement) {
  // Remove translation state too, so a language change cannot resurrect a cleared result.
  if (node.dataset['relative']) node.removeAttribute('title');
  for (const name of Object.keys(node.dataset))
    if (
      name === 'i18n' ||
      name === 'date' ||
      name === 'dateZone' ||
      name === 'relative' ||
      name === 'bytes' ||
      name === 'tone' ||
      name === 'byteParams' ||
      name.startsWith('param')
    )
      Reflect.deleteProperty(node.dataset, name);
  text(node, '');
  // The request reference of a cleared error must not resurface with a later message.
  const reference = node.nextElementSibling;
  if (reference instanceof HTMLElement && reference.classList.contains('error-ref'))
    reference.replaceChildren();
}
function apply(value: Language, next: Dictionary) {
  language = value;
  dictionary = next;
  document.documentElement.lang = value;
  document.documentElement.dir = directionOf(value);
  for (const listener of listeners) listener();
  for (const node of document.querySelectorAll<HTMLElement>(
    '[data-i18n], [data-i18n-placeholder], [data-i18n-label], [data-docs], [data-date], [data-bytes], [data-relative]',
  ))
    render(node);
}
async function fetchDictionary(value: Language): Promise<Dictionary> {
  // Beside the console's script, wherever the console is served from.
  const response = await fetch(new URL(`locales/${value}.json`, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return dictionaryFrom(await response.json());
}
/**
 * Shows the console in a language and remembers the choice. A bundled or already fetched
 * dictionary applies at once; otherwise false when it cannot be fetched (the page stays as it
 * is) or when a later choice was made while it loaded.
 */
export async function setLanguage(value: Language): Promise<boolean> {
  const request = ++requests;
  let next = dictionaries.get(value);
  if (!next) {
    try {
      next = await fetchDictionary(value);
    } catch {
      return false;
    }
    dictionaries.set(value, next);
  }
  if (request !== requests) return false;
  apply(value, next);
  savePreference('language', value);
  return true;
}
/** The saved or browser language; English this time when its dictionary cannot be fetched. */
export async function initializeLanguage(): Promise<Language> {
  if (await setLanguage(language)) return language;
  apply('en', en);
  return 'en';
}
export function currentLanguage(): Language {
  return language;
}

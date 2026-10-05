import { en } from './messages-en.js';
import { ru } from './messages-ru.js';
export { en, ru };
export type MessageKey = keyof typeof en;
/** Every text of the console in one language. */
export type Dictionary = Readonly<Record<MessageKey, string>>;
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}
export function translate(
  dictionary: Dictionary,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
) {
  return dictionary[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
/**
 * A dictionary fetched as JSON: every English key, with the translation where the file has a
 * non-empty text and English where it has none (an older file never leaves a control blank).
 */
export function dictionaryFrom(value: unknown): Dictionary {
  const texts: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result: Record<string, string> = {};
  for (const key of Object.keys(en) as MessageKey[]) {
    const text = Object.hasOwn(texts, key) ? texts[key] : undefined;
    result[key] = typeof text === 'string' && text.length > 0 ? text : en[key];
  }
  return result as Dictionary;
}
